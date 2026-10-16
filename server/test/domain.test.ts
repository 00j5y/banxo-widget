import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { seal, open, digest, matchesSecret, signBankJWT } from '../src/security.js';
import { selectBalance, snapshotState, emptySnapshot } from '../src/domain.js';

const balances = [
  { balance_type: 'ITAV', balance_amount: { amount: '93.19', currency: 'EUR' } },
  { balance_type: 'CLBD', balance_amount: { amount: '-120.01', currency: 'EUR' }, reference_date: '2026-10-16' },
];

test('priorise le solde comptabilisé et conserve les décimales exactes', () => {
  assert.deepEqual(selectBalance(balances), { amount: '-120.01', currency: 'EUR', balanceKind: 'booked', sourceDate: '2026-10-16' });
});
test('identifie le solde disponible sans le présenter comme comptabilisé', () => {
  assert.equal(selectBalance(balances.slice(0, 1)).balanceKind, 'available');
});
test('refuse les soldes prévisionnels, malformés ou hors EUR', () => {
  for (const entry of [
    { balance_type: 'FWAV', balance_amount: { amount: '1.00', currency: 'EUR' } },
    { balance_type: 'ITBD', balance_amount: { amount: 'NaN', currency: 'EUR' } },
    { balance_type: 'ITBD', balance_amount: { amount: '1.00', currency: 'USD' } },
  ]) assert.throws(() => selectBalance([entry]));
});
test('une absence de solde reste null, jamais zéro', () => {
  assert.equal(emptySnapshot().amount, null);
  assert.equal(emptySnapshot().status, 'not_connected');
});
test('le vieillissement ne remplace pas un état de reconnexion', () => {
  const snapshot = { ...emptySnapshot(), amount: '0.00', fetchedAt: '2026-10-16T00:00:00.000Z', status: 'ready' as const };
  const now = Date.parse('2026-10-16T08:00:00.000Z');
  assert.equal(snapshotState(snapshot, now).status, 'stale');
  assert.equal(snapshotState({ ...snapshot, status: 'reconnect_required' }, now).status, 'reconnect_required');
});
test('chiffre les données et détecte toute altération', () => {
  const key = Buffer.alloc(32, 8);
  const ciphertext = seal({ amount: '-12.03' }, key);
  assert.ok(!ciphertext.includes('-12.03'));
  assert.deepEqual(open(ciphertext, key), { amount: '-12.03' });
  const value = JSON.parse(ciphertext) as { data: string };
  value.data = Buffer.from('altéré').toString('base64');
  assert.throws(() => open(JSON.stringify(value), key));
  assert.throws(() => open(ciphertext, Buffer.alloc(32, 9)));
});
test('les secrets sont comparés par empreinte et sans accepter les valeurs vides', () => {
  assert.ok(matchesSecret('secret', digest('secret')));
  assert.ok(!matchesSecret('incorrect', digest('secret')));
  assert.ok(!matchesSecret('', digest('')));
});
test('signe les JWT Enable Banking au format attendu', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = signBankJWT('application-id', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 1_700_000_000);
  const [head, body, signature] = jwt.split('.') as [string, string, string];
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'RS256', kid: 'application-id' });
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url').toString()), { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_700_000_000, exp: 1_700_000_300 });
  assert.ok(verify('RSA-SHA256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature, 'base64url')));
});
