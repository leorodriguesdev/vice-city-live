const tierLabels = { 1000: 'NÍVEL 1', 2000: 'NÍVEL 2', 3000: 'NÍVEL 3' };
const anonymousName = 'ANÔNIMO';
const maxMessageLength = 80;

const tierLabel = (tier) => tierLabels[tier] || 'PRIME';

// Remove cheermotes ("Cheer100", "Kappa50") para a mensagem não virar uma lista de códigos.
function cleanMessage(text, fallback) {
  const cleaned = String(text || '')
    .replace(/(^|\s)[A-Za-z]+\d+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxMessageLength ? `${cleaned.slice(0, maxMessageLength - 1)}…` : cleaned;
}

export function buildSubscriptions(userId) {
  return [
    { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: userId, moderator_user_id: userId } },
    { type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: userId } },
    { type: 'channel.subscription.message', version: '1', condition: { broadcaster_user_id: userId } },
    { type: 'channel.subscription.gift', version: '1', condition: { broadcaster_user_id: userId } },
    { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: userId } },
    { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: userId } },
  ];
}

export function mapTwitchEvent(subscriptionType, event) {
  switch (subscriptionType) {
    case 'channel.follow':
      return { type: 'follow', name: event.user_name, message: 'BEM-VINDO(A) AO CANAL!' };
    case 'channel.subscribe':
      // Subs de presente já chegam agrupados em channel.subscription.gift.
      if (event.is_gift) return null;
      return { type: 'subscriber', name: event.user_name, amount: tierLabel(event.tier), message: 'VALEU PELO SUB!' };
    case 'channel.subscription.message': {
      const months = Number(event.cumulative_months) || 1;
      return {
        type: 'subscriber',
        name: event.user_name,
        amount: `${tierLabel(event.tier)} · ${months} ${months === 1 ? 'MÊS' : 'MESES'}`,
        message: cleanMessage(event.message && event.message.text, 'VALEU PELO RESUB!'),
      };
    }
    case 'channel.subscription.gift': {
      const total = Number(event.total) || 1;
      return {
        type: 'subscriber',
        name: event.is_anonymous ? anonymousName : event.user_name,
        amount: `${total} ${total === 1 ? 'SUB' : 'SUBS'} DE PRESENTE`,
        message: 'VALEU PELOS PRESENTES!',
      };
    }
    case 'channel.cheer':
      return {
        type: 'donation',
        name: event.is_anonymous ? anonymousName : event.user_name,
        amount: `${event.bits} BITS`,
        message: cleanMessage(event.message, 'VALEU PELOS BITS!'),
      };
    case 'channel.raid':
      return {
        type: 'raid',
        name: event.from_broadcaster_user_name,
        amount: `${event.viewers} RAIDERS`,
        message: 'CHEGOU A GANGUE!',
      };
    default:
      return null;
  }
}
