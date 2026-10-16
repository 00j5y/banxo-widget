import { readFileSync } from 'node:fs';
import { z } from 'zod';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env['NODE_ENV'] !== 'development' && env['NODE_ENV'] !== 'test';
  const publicUrl = new URL(env['PUBLIC_URL'] ?? 'http://localhost:3000');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/' ||
    (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && !production && loopback))) throw new Error('PUBLIC_URL doit être une origine HTTPS (localhost HTTP en développement).');
  const encodedKey = env['ENCRYPTION_KEY'] ?? readFileSync(env['ENCRYPTION_KEY_FILE'] ?? '../secrets/encryption.key', 'utf8').trim();
  const encryptionKey = Buffer.from(encodedKey, 'base64');
  if (encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY doit contenir 32 octets en base64.');
  const adminPasswordHash = z.string().regex(/^[a-f0-9]{64}$/).parse(env['ADMIN_PASSWORD_HASH']);
  const redisUrl = new URL(env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
  if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) throw new Error('REDIS_URL invalide.');
  const applicationId = env['ENABLE_BANKING_APP_ID'] ?? '';
  const privateKey = applicationId ? readFileSync(env['ENABLE_BANKING_PRIVATE_KEY_FILE'] ?? '../secrets/enable-banking.pem', 'utf8') : '';
  return { production, publicUrl: publicUrl.origin, adminPasswordHash, encryptionKey, redisUrl: redisUrl.href,
    applicationId, privateKey, port: z.coerce.number().int().min(1).max(65535).parse(env['PORT'] ?? 3000) };
}
