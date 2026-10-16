import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Bank } from './bank.js';
import type { Connection } from './domain.js';
import { BalanceService } from './service.js';
import type { Store } from './store.js';
import { digest, matchesSecret, newToken } from './security.js';
import { dashboard, escapeHTML, loginPage, page, stylesheet } from './ui.js';

export interface AppOptions { publicUrl: string; adminPasswordHash: string; production: boolean }
interface AdminSession { csrf: string }
interface Device { label: string; tokenHash: string; createdAt: string }
interface PendingAuth { adminHash: string; previousHash: string | null }
const slotSchema = z.enum(['iphone', 'mac']);

export async function createApp(options: AppOptions, store: Store, bank: Bank) {
  const app = Fastify({ logger: false, bodyLimit: 16_384, requestTimeout: 30_000 });
  const origin = new URL(options.publicUrl).origin;
  const balance = new BalanceService(store, bank);
  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'self'; form-action 'self' https://auth.enablebanking.com; base-uri 'none'; frame-ancestors 'none'");
    if (options.production) reply.header('strict-transport-security', 'max-age=31536000');
  });
  app.setErrorHandler((error, _request, reply) => {
    const parsed = z.object({ statusCode: z.number() }).safeParse(error);
    const status = error instanceof z.ZodError ? 400 : parsed.success && parsed.data.statusCode >= 400 && parsed.data.statusCode < 500 ? parsed.data.statusCode : 503;
    void reply.code(status).send({ error: status === 503 ? 'Service temporairement indisponible.' : 'Requête refusée.' });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/style.css', async (_request, reply) => reply.type('text/css').send(stylesheet));
  app.get('/', async (_request, reply) => reply.redirect('/admin'));

  async function admin(request: FastifyRequest, reply: FastifyReply): Promise<AdminSession | null> {
    const token = request.cookies['banxo_admin'];
    const session = token ? await store.get<AdminSession>(`admin:${digest(token)}`) : null;
    if (!session) { await reply.code(401).type('text/html').send(loginPage()); return null; }
    return session;
  }
  async function mutation(request: FastifyRequest, reply: FastifyReply): Promise<AdminSession | null> {
    const session = await admin(request, reply);
    if (!session) return null;
    const csrf = z.object({ csrf: z.string() }).passthrough().safeParse(request.body);
    if (request.headers.origin !== origin || !csrf.success || !matchesSecret(csrf.data.csrf, digest(session.csrf))) {
      await reply.code(403).send({ error: 'Origine ou protection CSRF invalide.' }); return null;
    }
    return session;
  }
  app.get('/api/v1/balance', async (request, reply) => {
    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token || token.length > 256) return reply.code(401).send({ error: 'Jeton requis.' });
    const devices = await Promise.all(['iphone', 'mac'].map(slot => store.get<Device>(`device:${slot}`)));
    if (!devices.some(device => device && matchesSecret(token, device.tokenHash))) return reply.code(401).send({ error: 'Jeton invalide.' });
    return balance.balance();
  });
  app.get('/admin', async (request, reply) => {
    const token = request.cookies['banxo_admin'];
    const session = token ? await store.get<AdminSession>(`admin:${digest(token)}`) : null;
    if (!session) return reply.type('text/html').send(loginPage());
    const devices: string[] = [];
    for (const slot of ['iphone', 'mac']) if (await store.get(`device:${slot}`)) devices.push(slot);
    return reply.type('text/html').send(dashboard(await store.get<Connection>('connection'), session.csrf, bank.configured, devices));
  });
  app.post('/admin/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: () => 'admin-login' } } }, async (request, reply) => {
    if (request.headers.origin !== origin) return reply.code(403).send({ error: 'Origine invalide.' });
    const body = z.object({ password: z.string().max(512) }).safeParse(request.body);
    if (!body.success || !matchesSecret(body.data.password, options.adminPasswordHash)) return reply.code(401).send({ error: 'Connexion refusée.' });
    const token = newToken();
    await store.set(`admin:${digest(token)}`, { csrf: newToken() }, 3600);
    return reply.setCookie('banxo_admin', token, { path: '/', httpOnly: true, secure: options.production, sameSite: 'lax', maxAge: 3600 }).redirect('/admin', 303);
  });
  app.post('/admin/logout', async (request, reply) => {
    if (!await mutation(request, reply)) return;
    await store.delete(`admin:${digest(request.cookies['banxo_admin'] ?? '')}`);
    return reply.clearCookie('banxo_admin', { path: '/' }).redirect('/admin', 303);
  });
  app.post('/admin/devices', async (request, reply) => {
    if (!await mutation(request, reply)) return;
    const body = z.object({ slot: slotSchema.default('mac') }).passthrough().parse(request.body);
    const token = newToken();
    await store.set(`device:${body.slot}`, { label: body.slot === 'mac' ? 'Mac' : 'iPhone', tokenHash: digest(token), createdAt: new Date().toISOString() } satisfies Device);
    return reply.type('text/html').send(page('Jeton de lecture', `<h1>Jeton ${body.slot === 'mac' ? 'Mac' : 'iPhone'}</h1><p>Copie ces valeurs dans l’application Swift. Le jeton ne sera affiché qu’ici.</p><h2>Adresse du serveur</h2><code>${escapeHTML(origin)}</code><h2>Jeton</h2><code>${token}</code><p><a href="/admin">Terminer</a></p>`));
  });
  app.post('/admin/devices/revoke', async (request, reply) => {
    if (!await mutation(request, reply)) return;
    const body = z.object({ slot: slotSchema }).passthrough().parse(request.body);
    await store.delete(`device:${body.slot}`);
    return reply.redirect('/admin', 303);
  });
  app.get('/admin/banks', async (request, reply) => {
    const session = await admin(request, reply); if (!session) return;
    const banks = (await bank.institutions()).filter(value => /caisse.*pargne|normandie/i.test(value.name));
    return reply.type('text/html').send(page('Choisir la caisse', `<h1>Connecter mon compte</h1><p>Choisis le connecteur correspondant à ta caisse Normandie. Tu seras redirigé vers le parcours bancaire pour donner ton autorisation.</p>${banks.length ? `<form method="post" action="/admin/connect"><input type="hidden" name="csrf" value="${session.csrf}"><label for="bank">Caisse régionale</label><select id="bank" name="bank">${banks.map(value => `<option>${escapeHTML(value.name)}</option>`).join('')}</select><button>Continuer vers la banque</button></form>` : '<p>Aucun connecteur Caisse d’Épargne disponible. Vérifie l’activation des comptes personnels dans Enable Banking.</p>'}`));
  });
  app.post('/admin/connect', async (request, reply) => {
    if (!await mutation(request, reply)) return;
    const body = z.object({ bank: z.string().min(1).max(200) }).passthrough().parse(request.body);
    const institution = (await bank.institutions()).find(value => value.name === body.bank);
    if (!institution) return reply.code(400).send({ error: 'Connecteur inconnu.' });
    const state = newToken();
    const old = await store.get<Connection>('connection');
    const url = await bank.authorize(institution.name, state, `${origin}/banking/callback`, institution.maximum_consent_validity);
    await store.set(`oauth:${digest(state)}`, { adminHash: digest(request.cookies['banxo_admin'] ?? ''), previousHash: old?.selectedAccount?.identificationHash ?? null } satisfies PendingAuth, 600);
    return reply.redirect(url, 303);
  });
  app.get('/banking/callback', async (request, reply) => {
    const query = z.object({ state: z.string().max(256), code: z.string().max(8192).optional(), error: z.string().max(256).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Retour bancaire invalide.' });
    const key = `oauth:${digest(query.data.state)}`;
    const pending = await store.get<PendingAuth>(key);
    if (!pending) return reply.code(400).send({ error: 'Autorisation expirée ou déjà utilisée.' });
    const cookieValue = request.cookies['banxo_admin'] ?? '';
    if (!matchesSecret(cookieValue, pending.adminHash) || !await store.get(`admin:${pending.adminHash}`)) return reply.code(403).send({ error: 'Navigateur non autorisé.' });
    const claimed = await store.take<PendingAuth>(key);
    if (!claimed) return reply.code(400).send({ error: 'Autorisation déjà utilisée.' });
    if (query.data.error || !query.data.code) return reply.type('text/html').send(page('Connexion annulée', '<h1>Connexion bancaire non terminée</h1><p><a href="/admin">Revenir à la configuration</a></p>'));
    const result = await bank.session(query.data.code);
    const selectedAccount = result.accounts.find(account => account.identificationHash === claimed.previousHash) ?? (result.accounts.length === 1 ? result.accounts[0] : null) ?? null;
    await store.write({ snapshot: null, connection: { ...result, selectedAccount, needsReauth: false } satisfies Connection });
    return reply.redirect('/admin', 303);
  });
  app.post('/admin/account', async (request, reply) => {
    if (!await mutation(request, reply)) return;
    const body = z.object({ account: z.string().max(256) }).passthrough().parse(request.body);
    const current = await store.getVersioned<Connection>('connection');
    const selectedAccount = current?.value.accounts.find(account => account.uid === body.account);
    if (!current || !selectedAccount) return reply.code(400).send({ error: 'Compte inconnu.' });
    const saved = await store.write({ snapshot: null, connection: { ...current.value, selectedAccount } }, { key: 'connection', version: current.version });
    if (!saved) return reply.code(409).send({ error: 'La connexion a changé. Actualise la page.' });
    return reply.redirect('/admin', 303);
  });
  app.post('/admin/disconnect', async (request, reply) => {
    if (!await mutation(request, reply)) return;
    const current = await store.getVersioned<Connection>('connection');
    // Révoquer chez le prestataire avant d'annoncer la déconnexion comme terminée.
    if (current) {
      await bank.revoke(current.value.sessionId);
      const saved = await store.write({ connection: null, snapshot: null }, { key: 'connection', version: current.version });
      if (!saved) return reply.code(409).send({ error: 'La connexion a changé. Actualise la page.' });
    }
    return reply.redirect('/admin', 303);
  });
  return app;
}
