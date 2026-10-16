import { createCipheriv, createDecipheriv, createHash, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
export function matchesSecret(value: string, hash: string): boolean {
  return value.length > 0 && hash.length === 64 && timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(hash, 'hex'));
}

export function seal(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}

export function open(value: string, key: Buffer): unknown {
  const envelope = z.object({ iv: z.string(), data: z.string(), tag: z.string() }).parse(JSON.parse(value));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')) as unknown;
}

export function signBankJWT(appId: string, privateKey: string, seconds = Math.floor(Date.now() / 1000)): string {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: seconds, exp: seconds + 300 })).toString('base64url');
  const content = `${header}.${payload}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}
