import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { open, seal } from './security.js';

export interface Store {
  get<T>(key: string): Promise<T | null>;
  getVersioned<T>(key: string): Promise<{ value: T; version: string } | null>;
  write(updates: Record<string, unknown | null>, guard?: { key: string; version: string }): Promise<boolean>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  take<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
  reserveAttempt(now: number): Promise<boolean>;
}

// La réservation est atomique et précède le réseau : un échec consomme son créneau.
export const reserveScript = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 86400000)
local latest = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
if #latest > 0 and now - tonumber(latest[2]) < 21600000 then return 0 end
if redis.call('ZCARD', KEYS[1]) >= 4 then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('EXPIRE', KEYS[1], 172800)
return 1`;

export class RedisStore implements Store {
  readonly client: ReturnType<typeof createClient>;
  constructor(url: string, private readonly encryptionKey: Buffer, private readonly prefix = 'banxo:') {
    this.client = createClient({ url, disableOfflineQueue: true, socket: {
      connectTimeout: 5000,
      reconnectStrategy: retries => Math.min(250 * 2 ** Math.min(retries, 5), 5000),
    } });
    // Les erreurs sont traitées par les appels ; ne jamais imprimer l'URL Redis.
    this.client.on('error', () => {});
  }
  async connect(): Promise<void> { await this.client.connect(); }
  async close(): Promise<void> { if (this.client.isOpen) await this.client.quit(); }
  async ping(): Promise<void> { await this.client.ping(); }
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(this.prefix + key);
    return value === null ? null : open(value, this.encryptionKey) as T;
  }
  async getVersioned<T>(key: string): Promise<{ value: T; version: string } | null> {
    const raw = await this.client.get(this.prefix + key);
    return raw === null ? null : { value: open(raw, this.encryptionKey) as T, version: raw };
  }
  async write(updates: Record<string, unknown | null>, guard?: { key: string; version: string }): Promise<boolean> {
    const entries = Object.entries(updates);
    // Comparer le chiffré lu évite une vérification suivie d'une écriture non atomique.
    const result = await this.client.eval(`
      if ARGV[1] ~= '' and redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      for i = 2, #KEYS do
        if ARGV[i] == '' then redis.call('DEL', KEYS[i])
        else redis.call('SET', KEYS[i], ARGV[i]) end
      end
      return 1`, {
      keys: [this.prefix + (guard?.key ?? 'connection'), ...entries.map(([key]) => this.prefix + key)],
      arguments: [guard?.version ?? '', ...entries.map(([, value]) => value === null ? '' : seal(value, this.encryptionKey))],
    });
    return result === 1;
  }
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const encrypted = seal(value, this.encryptionKey);
    if (ttlSeconds !== undefined) await this.client.set(this.prefix + key, encrypted, { EX: ttlSeconds });
    else await this.client.set(this.prefix + key, encrypted);
  }
  async take<T>(key: string): Promise<T | null> {
    const value = await this.client.getDel(this.prefix + key);
    return value === null ? null : open(value, this.encryptionKey) as T;
  }
  async delete(key: string): Promise<void> { await this.client.del(this.prefix + key); }
  async reserveAttempt(now: number): Promise<boolean> {
    return await this.client.eval(reserveScript, { keys: [this.prefix + 'attempts'], arguments: [String(now), randomUUID()] }) === 1;
  }
}
