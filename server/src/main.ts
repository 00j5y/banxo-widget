import { readConfig } from './config.js';
import { RedisStore } from './store.js';
import { EnableBanking } from './bank.js';
import { createApp } from './app.js';

async function main() {
  const config = readConfig();
  const store = new RedisStore(config.redisUrl, config.encryptionKey);
  await store.connect();
  const app = await createApp(config, store, new EnableBanking(config.applicationId, config.privateKey));
  app.get('/ready', async () => { await store.ping(); return { status: 'ok' }; });
  app.addHook('onClose', async () => store.close());
  await app.listen({ host: '0.0.0.0', port: config.port });
  process.stdout.write('Banxo API démarrée.\n');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1; });
  });
}
main().catch(() => {
  // Les exceptions peuvent inclure des URL et des réponses sensibles.
  process.stderr.write('Démarrage impossible. Vérifie la configuration et la disponibilité de Redis.\n');
  process.exitCode = 1;
});
