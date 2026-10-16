import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BalanceService } from '../src/service.js';
import { BankError } from '../src/bank.js';
import { TestStore, TestBank, connection } from './support.js';

function setup() {
  const store = new TestStore(); const bank = new TestBank();
  store.values.set('connection', structuredClone(connection));
  let now = Date.parse('2026-10-16T00:00:00.000Z');
  return { store, bank, service: new BalanceService(store, bank, () => now), advance: (hours: number) => { now += hours * 3_600_000; } };
}
test('deux appareils simultanés ne déclenchent qu’un seul appel', async () => {
  const { service, bank } = setup(); await Promise.all([service.balance(), service.balance()]);
  assert.equal(bank.calls, 1);
});
test('partage le cache pendant six heures puis récupère un nouveau solde', async () => {
  const { service, bank, advance } = setup();
  assert.equal((await service.balance()).amount, '-17.13');
  advance(5); await service.balance(); assert.equal(bank.calls, 1);
  advance(1); await service.balance(); assert.equal(bank.calls, 2);
});
test('une tentative échouée consomme également le quota', async () => {
  const { service, bank, advance } = setup();
  await service.balance(); advance(6); bank.error = new Error('indisponible'); await service.balance();
  advance(1); await service.balance(); assert.equal(bank.calls, 2);
  advance(1); assert.equal((await service.balance()).status, 'stale');
});
test('une session expirée conserve le dernier solde et demande une reconnexion', async () => {
  const { service, bank, advance } = setup(); await service.balance(); advance(6);
  bank.error = new BankError('reconnect');
  const result = await service.balance();
  assert.equal(result.status, 'reconnect_required'); assert.equal(result.amount, '-17.13');
  advance(6); await service.balance(); assert.equal(bank.calls, 2);
});
test('une expiration connue n’émet aucun appel bancaire', async () => {
  const { service, bank, advance } = setup(); advance(24 * 100);
  assert.equal((await service.balance()).status, 'reconnect_required'); assert.equal(bank.calls, 0);
});
test('aucune connexion n’entraîne ni appel ni faux solde', async () => {
  const { service, bank, store } = setup(); store.values.delete('connection');
  const result = await service.balance(); assert.equal(result.amount, null); assert.equal(result.status, 'not_connected'); assert.equal(bank.calls, 0);
});
test('respecte Retry-After au-delà de six heures', async () => {
  const { service, bank, advance } = setup(); bank.error = new BankError('transient', 48 * 3600);
  await service.balance(); advance(24); await service.balance(); assert.equal(bank.calls, 1);
});
test('un résultat en vol ne réintroduit pas une connexion supprimée', async () => {
  const { service, bank, store } = setup();
  bank.balances = async () => { store.values.delete('connection'); return [{ balance_type: 'ITBD', balance_amount: { amount: '1.00', currency: 'EUR' } }]; };
  assert.equal((await service.balance()).status, 'not_connected');
  assert.equal(await store.get('snapshot'), null);
});
test('une erreur initiale reste une erreur pendant le blocage du quota', async () => {
  const { service, bank } = setup(); bank.error = new Error('réseau');
  assert.equal((await service.balance()).status, 'error');
  assert.equal((await service.balance()).status, 'error');
  assert.equal(bank.calls, 1);
});
test('un ancien compte ne réécrit pas son solde après sélection d’un autre compte', async () => {
  const { service, bank, store } = setup();
  bank.balances = async () => {
    await store.set('connection', { ...connection, selectedAccount: { uid: 'another-account', identificationHash: 'another-hash', label: 'Autre' } });
    return [{ balance_type: 'ITBD', balance_amount: { amount: '1.00', currency: 'EUR' } }];
  };
  assert.equal((await service.balance()).amount, null);
  assert.equal(await store.get('snapshot'), null);
});
test('une déconnexion entre validation et écriture reste définitive', async () => {
  const { service, bank, store } = setup(); bank.error = new BankError('reconnect');
  const originalSet = store.set.bind(store);
  store.set = async (key, value) => {
    if (key === 'connection') store.values.delete('connection');
    return originalSet(key, value);
  };
  // La nouvelle écriture conditionnelle sera elle aussi confrontée à la suppression.
  const originalWrite = store.write?.bind(store);
  if (originalWrite) store.write = async (updates, guard) => {
    if ('connection' in updates) store.values.delete('connection');
    return originalWrite(updates, guard);
  };
  await service.balance();
  assert.equal(await store.get('connection'), null);
});
