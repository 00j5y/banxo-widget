import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { digest } from '../src/security.js';
const base = { NODE_ENV: 'production', PUBLIC_URL: 'https://bank.example.com', ADMIN_PASSWORD_HASH: digest('secret'), ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), REDIS_URL: 'redis://redis:6379' };
test('exige HTTPS en production et une clé de chiffrement de 32 octets', () => {
  assert.throws(() => readConfig({ ...base, PUBLIC_URL: 'http://bank.example.com' }));
  assert.throws(() => readConfig({ ...base, ENCRYPTION_KEY: 'short' }));
  assert.throws(() => readConfig({ ...base, PUBLIC_URL: 'https://bank.example.com/path?secret=1' }));
  assert.equal(readConfig(base).publicUrl, 'https://bank.example.com');
});
test('HTTP de développement reste limité à localhost', () => {
  assert.equal(readConfig({ ...base, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:3000' }).production, false);
  assert.throws(() => readConfig({ ...base, NODE_ENV: 'development', PUBLIC_URL: 'http://192.168.1.2:3000' }));
});
