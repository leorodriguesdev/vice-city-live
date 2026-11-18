# Vice City Live — OBS Overlay Pack

Overlays HTML 1920x1080 com transparência no documento, tema GTA VI / Vice City. Uso pessoal.

## Conteúdo
- starting-soon.html — tela de loading estilo GTA (slideshow de artes, spinner), countdown e ticker
- brb.html — pausa com letreiro neon sobre a arte do motel
- ending.html — "MISSÃO CUMPRIDA", encerramento e redes
- webcam-frame.html — moldura 16:9 configurável (miolo transparente)
- gameplay-hud.html — barra inferior com meta em estilo dinheiro do GTA, relógio e wanted stars
- alert.html — alertas com wanted stars (follow) e "MISSÃO CUMPRIDA" (sub/doação), com fila
- chat-box.html — moldura transparente para widget externo
- stinger-transition.html — transição CSS com logo do GTA VI no ponto de corte

## Estrutura
```
*.html
assets/
  fonts.css          @font-face compartilhado
  fonts/             Bebas Neue, Inter, Knewave, Bowlby One (woff2, OFL)
  img/               logos e fundos do GTA VI (webp/png)
```
Mantenha a pasta `assets/` ao lado dos HTML: os arquivos não funcionam mais isolados.

## Browser Source
Adicione cada HTML como Browser Source com Width=1920 e Height=1080, sem cor de fundo.

Para usar parâmetros, **desmarque "Local file"** e informe a URL com `file://` e a query string, por exemplo:
`file:///Users/voce/vice-city-live/gameplay-hud.html?channel=/LEO&goal=1000&current=725`

Ative "Refresh browser when scene becomes active" no starting-soon (o countdown não reinicia, veja abaixo) e no stinger, se preferir não depender do evento do OBS.

## Parâmetros
Comuns: `color=FF2E88` (cor principal, hex) e `bg=0` (starting-soon/brb/ending sem arte de fundo, para usar vídeo próprio por baixo).

- starting-soon: `title=A LIVE JÁ VAI|COMEÇAR` (`|` quebra linha; a última linha sai em pincel), `kicker`, `subtitle`, `ticker`, `minutes=5`, `until=21:00`, `reset=1`
- brb: `title`, `message`
- ending: `title=VALEU,|ATÉ A PRÓXIMA!`, `mission`, `credits`, `ig`, `tiktok`, `yt` (use `-` para esconder uma rede)
- webcam-frame: `x=70%`, `y=8%`, `w=27%`, `name`
- gameplay-hud: `channel`, `label`, `goal`, `current`, `prefix=$`, `stars=0..5`
- alert: `test=1`, `duration=6` (segundos), `mission=0` (todos os alertas no card)
- chat-box: `x`, `y`, `w`, `h`, `title`
- stinger: `duration=1200`, `logo=0`

### Countdown
`until=21:00` conta até o horário. Com `minutes`, o fim é salvo no navegador da fonte: recarregar a cena não reinicia a contagem. Ela só reinicia 30 min depois de terminar, ou com `reset=1`.

## Stinger
Use o vídeo pronto `assets/video/stinger.webm` (VP9 com alpha, 1920x1080, 60 fps, 1,2 s) como transição nativa:
OBS → Transições de cena → **+ → Stinger** → Arquivo de vídeo `assets/video/stinger.webm`, Tipo do ponto de transição **Tempo (ms)**, Ponto de transição **600**. A tela fica 100% coberta entre ~430 e ~800 ms.

O vídeo é gerado a partir das mesmas curvas do `stinger-transition.html` por `tools/render-stinger.py` (Python + Pillow). Para regenerar depois de mudar cores ou o logo: `npm run stinger` (requer `ffmpeg`).

O `stinger-transition.html` continua disponível como fonte Navegador: toca uma vez ao carregar e rearma quando a fonte fica ativa (`obsSourceActiveChanged`).

## Integração ao vivo (obs-websocket)
Os overlays escutam eventos enviados pelo próprio OBS via obs-websocket (Streamer.bot, SAMMI, Touch Portal etc.):

```json
{"requestType":"CallVendorRequest","requestData":{"vendorName":"obs-browser","requestType":"emit_event","requestData":{"event_name":"vcl-alert","event_data":{"type":"donation","name":"MIAMI_88","amount":"R$ 25,00","message":"VOCÊ É LENDA!"}}}}
```

| event_name | event_data | Overlay |
|---|---|---|
| `vcl-alert` | `{type: follow\|subscriber\|donation, name, amount, message, style?: card\|mission}` | alert |
| `vcl-goal` | `{current, goal, label?}` | gameplay-hud |
| `vcl-wanted` | `{level: 0..5}` | gameplay-hud |

No contexto da página também existem `window.showAlert()`, `window.setGoal()` e `window.setWanted()`.

## Ponte Twitch → OBS (`bridge/`)
Script Node sem dependências que escuta a Twitch (EventSub WebSocket) e dispara `vcl-alert` e `vcl-goal` nos overlays via obs-websocket. Requer Node 20.10+.

| Evento da Twitch | Alerta |
|---|---|
| Follow | card com wanted stars; atualiza a meta da HUD |
| Sub, resub, sub de presente | MISSÃO CUMPRIDA (nível, meses ou quantidade) |
| Bits | MISSÃO CUMPRIDA (quantidade de bits) |
| Raid | MISSÃO CUMPRIDA (número de raiders) |

Configuração (uma vez):
1. Em https://dev.twitch.tv/console, registre um app: OAuth Redirect URL `http://localhost`, categoria Broadcaster Suite, **Client Type: Public**. Copie o Client ID.
2. `cp .env.example .env` e preencha `TWITCH_CLIENT_ID`, `OBS_PASSWORD` e, se quiser, `FOLLOWER_GOAL`.
3. No OBS: Ferramentas → Configurações do servidor WebSocket → ativar servidor e copiar a senha.
4. `npm run bridge:test` com o OBS aberto: envia alertas de exemplo e encerra (confere a ligação com o OBS sem passar pela Twitch).

Em cada live: `npm run bridge` e deixe o terminal aberto. Na primeira vez, ele mostra um link e um código para autorizar na Twitch; o token fica em `bridge/.twitch-token.json` (fora do Git) e é renovado sozinho. Para trocar de conta: `npm run bridge:login`.

Subs e bits só existem para canais Afiliado/Parceiro; em canal sem isso, o script avisa e segue ouvindo follows e raids.

Testes do mapeamento de eventos: `npm test`.

## Fontes
Títulos no estilo GTA usam a família `GTA`: se a **Pricedown** (Typodermic, comercial) estiver instalada no sistema ela é usada automaticamente; senão cai para Bowlby One. A tipografia em pincel usa Knewave. Todas as fontes são locais, sem depender de internet.

## Créditos
Logos e artes de Grand Theft Auto VI © Rockstar Games / Take-Two, baixados de rockstargames.com/VI/downloads. Uso pessoal, não redistribuir.

## Personalização
Cores e tipografia ficam nas variáveis `:root` de cada arquivo; os brilhos derivam de `--pink` via `color-mix`, então `color=` muda tudo junto.
