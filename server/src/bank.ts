import { z } from 'zod';
import { signBankJWT } from './security.js';
import type { Account } from './domain.js';

export class BankError extends Error {
  constructor(readonly kind: 'reconnect' | 'transient' | 'configuration', readonly retryAfterSeconds = 0) {
    super('Le service bancaire est indisponible.');
  }
}
const institutionSchema = z.object({ name: z.string(), country: z.string(), maximum_consent_validity: z.number().positive().default(86400) });
export type Institution = z.infer<typeof institutionSchema>;
export interface BankSession { sessionId: string; expiresAt: string; accounts: Account[] }
export interface Bank {
  configured: boolean;
  institutions(): Promise<Institution[]>;
  authorize(name: string, state: string, callback: string, validSeconds: number): Promise<string>;
  session(code: string): Promise<BankSession>;
  balances(accountId: string): Promise<unknown[]>;
  revoke(sessionId: string): Promise<void>;
}

export class EnableBanking implements Bank {
  readonly configured: boolean;
  constructor(private readonly applicationId: string, private readonly privateKey: string, private readonly fetcher: typeof fetch = fetch) {
    this.configured = Boolean(applicationId && privateKey);
  }
  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    if (!this.configured) throw new BankError('configuration');
    let response: Response;
    try {
      response = await this.fetcher(`https://api.enablebanking.com${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { authorization: `Bearer ${signBankJWT(this.applicationId, this.privateKey)}`, accept: 'application/json', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new BankError('transient'); }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(data);
      if (error.success && /^(EXPIRED_SESSION|INVALID_SESSION|CLOSED_SESSION|REVOKED_SESSION)$/.test(error.data.error)) throw new BankError('reconnect');
      const retry = response.headers.get('retry-after');
      const retrySeconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))) : 0;
      throw new BankError(response.status === 401 ? 'configuration' : 'transient', Number.isFinite(retrySeconds) ? retrySeconds : 0);
    }
    return data;
  }
  async institutions(): Promise<Institution[]> {
    return z.object({ aspsps: z.array(institutionSchema) }).parse(await this.request('/aspsps?country=FR&psu_type=personal')).aspsps.filter(value => value.country === 'FR');
  }
  async authorize(name: string, state: string, callback: string, validSeconds: number): Promise<string> {
    const result = z.object({ url: z.string().url() }).parse(await this.request('/auth', 'POST', {
      aspsp: { name, country: 'FR' }, psu_type: 'personal', language: 'fr', state, redirect_url: callback,
      access: { valid_until: new Date(Date.now() + Math.min(validSeconds, 180 * 86400) * 1000).toISOString() },
    }));
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'enablebanking.com' || url.hostname.endsWith('.enablebanking.com'))) throw new BankError('configuration');
    return url.href;
  }
  async session(code: string): Promise<BankSession> {
    const data = z.object({ session_id: z.string(), access: z.object({ valid_until: z.iso.datetime({ offset: true }) }), accounts: z.array(z.object({
      uid: z.string(), identification_hash: z.string(), name: z.string().optional(), currency: z.string(), cash_account_type: z.string().optional(),
    })) }).parse(await this.request('/sessions', 'POST', { code }));
    return { sessionId: data.session_id, expiresAt: data.access.valid_until, accounts: data.accounts.filter(value => value.currency === 'EUR' && value.cash_account_type === 'CACC').map(value => ({ uid: value.uid, identificationHash: value.identification_hash, label: value.name ?? 'Compte courant' })) };
  }
  async balances(accountId: string): Promise<unknown[]> {
    return z.object({ balances: z.array(z.unknown()) }).parse(await this.request(`/accounts/${encodeURIComponent(accountId)}/balances`)).balances;
  }
  async revoke(sessionId: string): Promise<void> { await this.request(`/sessions/${encodeURIComponent(sessionId)}`, 'DELETE'); }
}
