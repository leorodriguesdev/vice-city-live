import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSubscriptions, mapTwitchEvent } from './alert-mapper.mjs';

if (typeof WebSocket === 'undefined') {
  console.error('WebSocket indisponível. Use Node 22+ ou rode com: node --experimental-websocket');
  process.exit(1);
}

const config = {
  clientId: process.env.TWITCH_CLIENT_ID,
  obsUrl: process.env.OBS_URL || 'ws://127.0.0.1:4455',
  obsPassword: process.env.OBS_PASSWORD || '',
  followerGoal: Number(process.env.FOLLOWER_GOAL) || undefined,
};
const tokenFile = fileURLToPath(new URL('./.twitch-token.json', import.meta.url));
const scopes = ['moderator:read:followers', 'channel:read:subscriptions', 'bits:read'];
const eventSubUrl = 'wss://eventsub.wss.twitch.tv/ws';
const args = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log(new Date().toLocaleTimeString('pt-BR'), ...parts);

// ---------- OBS (obs-websocket v5) ----------

const obsCloseReasons = {
  1006: 'sem resposta (OBS fechado ou servidor WebSocket desligado)',
  4009: 'senha incorreta (confira OBS_PASSWORD no .env)',
  4010: 'versão do obs-websocket incompatível',
};

class ObsClient {
  #socket = null;
  #identified = false;
  #pending = [];
  #onReady = [];

  constructor(url, password) {
    this.url = url;
    this.password = password;
  }

  onReady(listener) {
    this.#onReady.push(listener);
  }

  connect() {
    const socket = new WebSocket(this.url);
    this.#socket = socket;
    socket.onmessage = (message) => this.#handle(JSON.parse(message.data));
    socket.onclose = (event) => {
      const reason = obsCloseReasons[event.code] || `código ${event.code}${event.reason ? ` (${event.reason})` : ''}`;
      // Loga só quando o motivo muda, para não repetir a mesma linha a cada 5 s.
      if (this.#identified || reason !== this.lastCloseReason) log(`OBS: ${reason}. Tentando de novo em 5 s...`);
      this.lastCloseReason = reason;
      this.#identified = false;
      setTimeout(() => this.connect(), 5000);
    };
    socket.onerror = () => {};
  }

  #handle({ op, d }) {
    if (op === 0) {
      const identify = { rpcVersion: 1, eventSubscriptions: 0 };
      if (d.authentication) identify.authentication = this.#authentication(d.authentication);
      this.#socket.send(JSON.stringify({ op: 1, d: identify }));
    } else if (op === 2) {
      this.#identified = true;
      log('OBS conectado.');
      this.#pending.splice(0).forEach((payload) => this.#socket.send(payload));
      this.#onReady.forEach((listener) => listener());
    } else if (op === 7 && !d.requestStatus.result) {
      log('OBS recusou o pedido:', d.requestStatus.comment || d.requestStatus.code);
    }
  }

  #authentication({ salt, challenge }) {
    const sha256 = (value) => createHash('sha256').update(value).digest('base64');
    return sha256(sha256(this.password + salt) + challenge);
  }

  // Dispara um evento JS em todas as fontes Navegador (vendor "obs-browser").
  emit(eventName, eventData) {
    const payload = JSON.stringify({
      op: 6,
      d: {
        requestType: 'CallVendorRequest',
        requestId: randomUUID(),
        requestData: { vendorName: 'obs-browser', requestType: 'emit_event', requestData: { event_name: eventName, event_data: eventData } },
      },
    });
    if (this.#identified) this.#socket.send(payload);
    else if (this.#pending.length < 20) this.#pending.push(payload);
  }
}

// ---------- Twitch: autenticação (Device Code Grant, cliente público) ----------

async function postForm(url, body) {
  const response = await fetch(url, { method: 'POST', body: new URLSearchParams(body) });
  return { status: response.status, data: await response.json() };
}

async function saveToken(token) {
  await writeFile(tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function loginWithDeviceCode() {
  const { data: device } = await postForm('https://id.twitch.tv/oauth2/device', { client_id: config.clientId, scopes: scopes.join(' ') });
  if (!device.device_code) throw new Error(`Falha ao iniciar login: ${JSON.stringify(device)}`);
  console.log(`\nAbra ${device.verification_uri} e confirme o código ${device.user_code}\n`);
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep((device.interval || 5) * 1000);
    const { status, data } = await postForm('https://id.twitch.tv/oauth2/token', {
      client_id: config.clientId,
      scopes: scopes.join(' '),
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (status === 200) {
      await saveToken(data);
      log('Login na Twitch concluído.');
      return data;
    }
    if (data.message !== 'authorization_pending') throw new Error(`Login recusado: ${data.message}`);
  }
  throw new Error('Código expirou. Rode de novo.');
}

async function refreshToken(token) {
  const { status, data } = await postForm('https://id.twitch.tv/oauth2/token', {
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
  });
  if (status !== 200) return loginWithDeviceCode();
  await saveToken(data);
  return data;
}

async function loadToken() {
  if (args.has('--login')) return loginWithDeviceCode();
  let token;
  try {
    token = JSON.parse(await readFile(tokenFile, 'utf8'));
  } catch {
    return loginWithDeviceCode();
  }
  const validation = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token.access_token}` } });
  return validation.ok ? token : refreshToken(token);
}

// ---------- Twitch: Helix ----------

let token;

async function helix(path, options = {}) {
  const request = () =>
    fetch(`https://api.twitch.tv/helix/${path}`, {
      ...options,
      headers: { 'Client-Id': config.clientId, Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    });
  let response = await request();
  if (response.status === 401) {
    token = await refreshToken(token);
    response = await request();
  }
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

// ---------- Twitch: EventSub WebSocket ----------

function startEventSub(userId, onNotification, onSessionReady) {
  let socket;
  let watchdog;
  let reconnectDelay = 1000;

  const open = (url, isMigration) => {
    const next = new WebSocket(url);
    let keepaliveMs = 15000;
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        log('Twitch sem sinal. Reconectando...');
        next.close();
      }, keepaliveMs + 5000);
    };

    next.onmessage = async (message) => {
      const { metadata, payload } = JSON.parse(message.data);
      armWatchdog();
      switch (metadata.message_type) {
        case 'session_welcome': {
          keepaliveMs = (payload.session.keepalive_timeout_seconds || 10) * 1000;
          armWatchdog();
          const previous = socket;
          socket = next;
          reconnectDelay = 1000;
          // Na migração (session_reconnect) as assinaturas são mantidas pela Twitch.
          if (isMigration) previous?.close();
          else await onSessionReady(payload.session.id);
          break;
        }
        case 'notification':
          onNotification(metadata.subscription_type, payload.event);
          break;
        case 'session_reconnect':
          log('Twitch pediu migração de conexão.');
          open(payload.session.reconnect_url, true);
          break;
        case 'revocation':
          log(`Assinatura revogada: ${payload.subscription.type} (${payload.subscription.status})`);
          break;
      }
    };

    next.onclose = () => {
      if (next !== socket) return;
      clearTimeout(watchdog);
      log(`Conexão com a Twitch caiu. Nova tentativa em ${reconnectDelay / 1000} s...`);
      setTimeout(() => open(eventSubUrl, false), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
    };
    next.onerror = () => {};
    // Na migração, a conexão antiga segue ativa até o welcome da nova.
    if (!isMigration) socket = next;
  };

  open(eventSubUrl, false);
}

// ---------- Execução ----------

const obs = new ObsClient(config.obsUrl, config.obsPassword);

async function runTest() {
  const samples = [
    { type: 'follow', name: 'VICE_PLAYER', message: 'BEM-VINDO(A) AO CANAL!' },
    { type: 'subscriber', name: 'SUNSET_GAMER', amount: 'NÍVEL 1', message: 'VALEU PELO SUB!' },
    { type: 'donation', name: 'MIAMI_88', amount: '500 BITS', message: 'VOCÊ É LENDA!' },
    { type: 'raid', name: 'GANGUE_DO_LEO', amount: '42 RAIDERS', message: 'CHEGOU A GANGUE!' },
  ];
  obs.onReady(async () => {
    samples.forEach((sample) => obs.emit('vcl-alert', sample));
    obs.emit('vcl-goal', { current: 742, goal: config.followerGoal || 1000 });
    obs.emit('vcl-wanted', { level: 3 });
    log('Alertas de teste enviados. Encerrando em 2 s.');
    await sleep(2000);
    process.exit(0);
  });
  log(`Conectando ao OBS em ${config.obsUrl}...`);
  obs.connect();
  setTimeout(() => {
    console.error('Não conectou ao OBS em 15 s. Veja a mensagem acima.');
    process.exit(1);
  }, 15000);
}

async function run() {
  if (!config.clientId) {
    console.error('Defina TWITCH_CLIENT_ID no arquivo .env (veja .env.example).');
    process.exit(1);
  }
  token = await loadToken();
  const { data: users } = await helix('users');
  const user = users.data && users.data[0];
  if (!user) throw new Error('Não foi possível ler o usuário da Twitch.');
  log(`Canal: ${user.display_name}`);

  const updateGoal = async () => {
    const { data } = await helix(`channels/followers?broadcaster_id=${user.id}&first=1`);
    if (typeof data.total === 'number') obs.emit('vcl-goal', { current: data.total, goal: config.followerGoal });
  };

  obs.onReady(updateGoal);
  obs.connect();
  setInterval(updateGoal, 2 * 60 * 1000);

  startEventSub(
    user.id,
    (subscriptionType, event) => {
      const alert = mapTwitchEvent(subscriptionType, event);
      if (!alert) return;
      log(`Alerta: ${subscriptionType} · ${alert.name}`);
      obs.emit('vcl-alert', alert);
      if (subscriptionType === 'channel.follow') updateGoal();
    },
    async (sessionId) => {
      for (const subscription of buildSubscriptions(user.id)) {
        const { status, data } = await helix('eventsub/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ ...subscription, transport: { method: 'websocket', session_id: sessionId } }),
        });
        if (status === 202) log(`Ouvindo ${subscription.type}`);
        else log(`Não deu para ouvir ${subscription.type}: ${data.message || status}`);
      }
    },
  );
}

(args.has('--test') ? runTest() : run()).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
