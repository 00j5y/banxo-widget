import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { RedisStore } = await import(pathToFileURL(resolve('server/dist/store.js')).href);

// Exécuté dans le conteneur API : clés de test isolées, aucune modification des données réelles.
const prefix = `banxo-test:${randomUUID()}:`;
const store = new RedisStore(process.env.REDIS_URL ?? 'redis://redis:6379', randomBytes(32), prefix);
await store.connect();
try {
  await store.set('private', { value: 'donnée sensible de test' });
  const raw = await store.client.get(prefix + 'private');
  assert.ok(!raw.includes('sensible'));
  assert.deepEqual(await store.get('private'), { value: 'donnée sensible de test' });
  await store.set('one-use', { state: 'test' }, 60);
  const consumed = await Promise.all([store.take('one-use'), store.take('one-use')]);
  assert.equal(consumed.filter(Boolean).length, 1);
  await store.set('guard', { session: 'before' });
  const guarded = await store.getVersioned('guard');
  await store.delete('guard');
  assert.equal(await store.write({ guard: { session: 'resurrected' }, derived: { amount: '12.00' } }, { key: 'guard', version: guarded.version }), false);
  assert.equal(await store.get('guard'), null);
  assert.equal(await store.get('derived'), null);
  await store.set('guard', { session: 'current' });
  const current = await store.getVersioned('guard');
  assert.equal(await store.write({ derived: { amount: '12.00' } }, { key: 'guard', version: current.version }), true);
  assert.deepEqual(await store.get('derived'), { amount: '12.00' });
  const now = Date.now();
  assert.equal((await Promise.all(Array.from({ length: 20 }, () => store.reserveAttempt(now)))).filter(Boolean).length, 1);
  assert.equal(await store.reserveAttempt(now + 6 * 3_600_000 - 1), false);
  for (const hours of [6, 12, 18]) assert.equal(await store.reserveAttempt(now + hours * 3_600_000), true);
  assert.equal(await store.reserveAttempt(now + 23 * 3_600_000), false);
  assert.equal(await store.reserveAttempt(now + 24 * 3_600_000), true);
  process.stdout.write('Redis réel OK : chiffrement, consommation unique, concurrence, six heures et fenêtre glissante.\n');
} finally {
  await store.client.del([prefix + 'private', prefix + 'one-use', prefix + 'attempts', prefix + 'guard', prefix + 'derived']);
  await store.close();
}
