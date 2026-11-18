import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptions, mapTwitchEvent } from './alert-mapper.mjs';

test('follow vira alerta de seguidor', () => {
  assert.deepEqual(mapTwitchEvent('channel.follow', { user_name: 'Vice_Player' }), {
    type: 'follow',
    name: 'Vice_Player',
    message: 'BEM-VINDO(A) AO CANAL!',
  });
});

test('sub novo mostra o nível', () => {
  const alert = mapTwitchEvent('channel.subscribe', { user_name: 'Sunset', tier: '2000', is_gift: false });
  assert.equal(alert.type, 'subscriber');
  assert.equal(alert.amount, 'NÍVEL 2');
});

test('sub recebido de presente é ignorado para não duplicar o alerta do gift', () => {
  assert.equal(mapTwitchEvent('channel.subscribe', { user_name: 'Sunset', tier: '1000', is_gift: true }), null);
});

test('resub mostra meses no singular e no plural', () => {
  const one = mapTwitchEvent('channel.subscription.message', { user_name: 'A', tier: '1000', cumulative_months: 1, message: { text: '' } });
  const many = mapTwitchEvent('channel.subscription.message', { user_name: 'A', tier: '1000', cumulative_months: 12, message: { text: 'boa live' } });
  assert.equal(one.amount, 'NÍVEL 1 · 1 MÊS');
  assert.equal(one.message, 'VALEU PELO RESUB!');
  assert.equal(many.amount, 'NÍVEL 1 · 12 MESES');
  assert.equal(many.message, 'boa live');
});

test('gift anônimo esconde o nome', () => {
  const alert = mapTwitchEvent('channel.subscription.gift', { user_name: null, is_anonymous: true, total: 5, tier: '1000' });
  assert.equal(alert.name, 'ANÔNIMO');
  assert.equal(alert.amount, '5 SUBS DE PRESENTE');
});

test('bits removem cheermotes e caem no texto padrão quando sobra vazio', () => {
  const withText = mapTwitchEvent('channel.cheer', { user_name: 'Miami', is_anonymous: false, bits: 100, message: 'Cheer100 você é lenda' });
  const onlyCheer = mapTwitchEvent('channel.cheer', { user_name: 'Miami', is_anonymous: false, bits: 100, message: 'Cheer50 Kappa50' });
  assert.equal(withText.type, 'donation');
  assert.equal(withText.amount, '100 BITS');
  assert.equal(withText.message, 'você é lenda');
  assert.equal(onlyCheer.message, 'VALEU PELOS BITS!');
});

test('mensagem longa é truncada em 80 caracteres', () => {
  const alert = mapTwitchEvent('channel.cheer', { user_name: 'A', bits: 1, message: 'x'.repeat(200) });
  assert.equal(alert.message.length, 80);
  assert.ok(alert.message.endsWith('…'));
});

test('raid usa o canal de origem e o número de espectadores', () => {
  assert.deepEqual(mapTwitchEvent('channel.raid', { from_broadcaster_user_name: 'Gangue', viewers: 42 }), {
    type: 'raid',
    name: 'Gangue',
    amount: '42 RAIDERS',
    message: 'CHEGOU A GANGUE!',
  });
});

test('evento desconhecido não gera alerta', () => {
  assert.equal(mapTwitchEvent('channel.update', {}), null);
});

test('assinaturas usam o id do canal nas condições corretas', () => {
  const subscriptions = buildSubscriptions('123');
  const follow = subscriptions.find((subscription) => subscription.type === 'channel.follow');
  const raid = subscriptions.find((subscription) => subscription.type === 'channel.raid');
  assert.equal(subscriptions.length, 6);
  assert.deepEqual(follow.condition, { broadcaster_user_id: '123', moderator_user_id: '123' });
  assert.equal(follow.version, '2');
  assert.deepEqual(raid.condition, { to_broadcaster_user_id: '123' });
});
