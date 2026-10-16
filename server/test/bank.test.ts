import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EnableBanking, BankError } from '../src/bank.js';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

test('authentifie les appels et transforme les comptes en identifiants stables', async () => {
  let called = false;
  const bank = new EnableBanking('app', pem, async (input, init) => {
    called = true; assert.equal(String(input), 'https://api.enablebanking.com/sessions');
    assert.match(new Headers(init?.headers).get('authorization') ?? '', /^Bearer /);
    return Response.json({ session_id: 's', access: { valid_until: '2027-01-01T00:00:00Z' }, accounts: [{ uid: 'a', identification_hash: 'stable', name: 'Courant', currency: 'EUR', cash_account_type: 'CACC' }] });
  });
  assert.deepEqual((await bank.session('code')).accounts, [{ uid: 'a', identificationHash: 'stable', label: 'Courant' }]); assert.ok(called);
});
test('une erreur de session provoque une demande de reconnexion', async () => {
  const bank = new EnableBanking('app', pem, async () => Response.json({ error: 'EXPIRED_SESSION' }, { status: 400 }));
  await assert.rejects(bank.balances('a'), (error: unknown) => error instanceof BankError && error.kind === 'reconnect');
});
test('refuse les redirections bancaires vers des destinations arbitraires', async () => {
  const bank = new EnableBanking('app', pem, async () => Response.json({ url: 'https://evil.example/steal' }));
  await assert.rejects(bank.authorize('Normandie', 'state', 'https://bank.example/callback', 3600));
});
test('échoue explicitement si les clés bancaires sont absentes', async () => {
  const bank = new EnableBanking('', '', async () => { throw new Error('Aucun réseau attendu'); });
  assert.equal(bank.configured, false); await assert.rejects(bank.balances('a'));
});
test('les codes documentés de fermeture et révocation demandent une reconnexion', async () => {
  for (const code of ['CLOSED_SESSION', 'REVOKED_SESSION']) {
    const bank = new EnableBanking('app', pem, async () => Response.json({ error: code }, { status: 400 }));
    await assert.rejects(bank.balances('a'), (error: unknown) => error instanceof BankError && error.kind === 'reconnect');
  }
});
