import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = 'http://localhost:3000';
const password = (await readFile(new URL('../secrets/admin-password.txt', import.meta.url), 'utf8')).trim();
const request = async (path, body, cookie) => fetch(base + path, {
  method: body ? 'POST' : 'GET', redirect: 'manual',
  headers: { origin: base, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
  ...(body ? { body: new URLSearchParams(body) } : {}),
});

assert.equal((await request('/ready')).status, 200);
assert.equal((await request('/api/v1/balance')).status, 401);
const login = await request('/admin/login', { password });
assert.equal(login.status, 303);
const cookie = login.headers.getSetCookie()[0]?.split(';')[0]; assert.ok(cookie);
const admin = await request('/admin', undefined, cookie);
assert.equal(admin.status, 200);
const csrf = (await admin.text()).match(/name="csrf" value="([^"]+)"/)?.[1]; assert.ok(csrf);
const created = await request('/admin/devices', { csrf, slot: 'mac' }, cookie);
assert.equal(created.status, 200);
const token = [...(await created.text()).matchAll(/<code>([^<]+)<\/code>/g)][1]?.[1]; assert.ok(token);
const snapshot = await fetch(base + '/api/v1/balance', { headers: { authorization: `Bearer ${token}` } });
assert.equal(snapshot.status, 200);
const data = await snapshot.json();
assert.equal(data.status, 'not_connected'); assert.equal(data.amount, null);
assert.match(snapshot.headers.get('cache-control'), /no-store/);
assert.equal((await request('/admin/devices/revoke', { csrf, slot: 'mac' }, cookie)).status, 303);
assert.equal((await fetch(base + '/api/v1/balance', { headers: { authorization: `Bearer ${token}` } })).status, 401);
assert.equal((await request('/admin/logout', { csrf }, cookie)).status, 303);
process.stdout.write('Smoke Docker OK : disponibilité, connexion admin, jeton, lecture sans banque, révocation, déconnexion. Aucun secret affiché.\n');
