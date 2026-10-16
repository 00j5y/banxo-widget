import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { TestBank, TestStore, connection } from './support.js';
import { digest } from '../src/security.js';

const origin = 'https://bank.example.com';
const options = { publicUrl: origin, adminPasswordHash: digest('a-very-long-administrator-password'), production: true };
async function setup() {
  const store = new TestStore(); const bank = new TestBank();
  const app = await createApp(options, store, bank);
  async function login() {
    const response = await app.inject({ method: 'POST', url: '/admin/login', headers: { origin }, payload: { password: 'a-very-long-administrator-password' } });
    assert.equal(response.statusCode, 303);
    const cookie = response.cookies.find(value => value.name === 'banxo_admin'); assert.ok(cookie);
    const session = await store.get<{ csrf: string }>(`admin:${digest(cookie.value)}`); assert.ok(session);
    return { headers: { origin, cookie: `banxo_admin=${cookie.value}` }, csrf: session.csrf };
  }
  return { app, store, bank, login };
}
test('protège le solde et exclut les réponses du cache public', async t => {
  const { app, store } = await setup(); t.after(() => app.close());
  assert.equal((await app.inject('/api/v1/balance')).statusCode, 401);
  await store.set('device:iphone', { label: 'iPhone', tokenHash: digest('device-secret'), createdAt: new Date().toISOString() });
  const response = await app.inject({ url: '/api/v1/balance', headers: { authorization: 'Bearer device-secret' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().amount, null);
  assert.match(response.headers['cache-control'] as string, /no-store/);
  await store.delete('device:iphone');
  assert.equal((await app.inject({ url: '/api/v1/balance', headers: { authorization: 'Bearer device-secret' } })).statusCode, 401);
});
test('exige authentification, origine et CSRF pour les opérations administratives', async t => {
  const { app, login } = await setup(); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/admin/devices', payload: { label: 'Mac' } })).statusCode, 401);
  const session = await login();
  assert.equal((await app.inject({ method: 'POST', url: '/admin/devices', headers: session.headers, payload: { label: 'Mac', csrf: 'incorrect' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/admin/devices', headers: { ...session.headers, origin: 'https://evil.example' }, payload: { label: 'Mac', csrf: session.csrf } })).statusCode, 403);
  const response = await app.inject({ method: 'POST', url: '/admin/devices', headers: session.headers, payload: { label: 'Mac', csrf: session.csrf } });
  assert.equal(response.statusCode, 200); assert.match(response.body, /Jeton/);
});
test('refuse une connexion administrateur incorrecte ou depuis un autre site', async t => {
  const { app } = await setup(); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/admin/login', headers: { origin }, payload: { password: 'incorrect' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/admin/login', headers: { origin: 'https://evil.example' }, payload: { password: 'a-very-long-administrator-password' } })).statusCode, 403);
});
test('lie le retour bancaire au navigateur puis interdit son rejeu', async t => {
  const { app, store, bank, login } = await setup(); t.after(() => app.close()); const session = await login();
  bank.session = async () => ({ sessionId: 'new', expiresAt: '2027-01-01T00:00:00Z', accounts: connection.accounts });
  let returnedState = '';
  bank.authorize = async (_name, state) => { returnedState = state; return 'https://auth.enablebanking.com/ais/start'; };
  const start = await app.inject({ method: 'POST', url: '/admin/connect', headers: session.headers, payload: { bank: 'Caisse Normandie', csrf: session.csrf } });
  assert.equal(start.statusCode, 303); assert.ok(returnedState);
  const callback = `/banking/callback?code=code&state=${returnedState}`;
  assert.equal((await app.inject(callback)).statusCode, 403);
  assert.equal((await app.inject({ url: callback, headers: session.headers })).statusCode, 303);
  assert.equal((await app.inject({ url: callback, headers: session.headers })).statusCode, 400);
  assert.equal((await store.get<{ sessionId: string }>('connection'))?.sessionId, 'new');
});
test('échappe les libellés fournis par la banque dans la page administrateur', async t => {
  const { app, store, login } = await setup(); t.after(() => app.close()); const session = await login();
  await store.set('connection', { ...connection, accounts: [{ ...connection.accounts[0], label: '<script>alert(1)</script>' }] });
  const response = await app.inject({ url: '/admin', headers: session.headers });
  assert.ok(!response.body.includes('<script>alert(1)</script>')); assert.ok(response.body.includes('&lt;script&gt;'));
});
test('une panne de persistance fait échouer les requêtes sans exposer de secret', async t => {
  const { app, store } = await setup(); t.after(() => app.close());
  store.get = async () => { throw new Error('redis://user:secret@private'); };
  const response = await app.inject({ url: '/api/v1/balance', headers: { authorization: 'Bearer secret' } });
  assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('redis'));
});
test('la politique des formulaires autorise le parcours de redirection bancaire', async t => {
  const { app, login } = await setup(); t.after(() => app.close()); const session = await login();
  const response = await app.inject({ url: '/admin/banks', headers: session.headers });
  assert.match(response.headers['content-security-policy'] as string, /form-action[^;]+https:\/\/auth\.enablebanking\.com/);
});
