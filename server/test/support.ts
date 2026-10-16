import type { Store } from '../src/store.js';
import type { Bank, BankSession } from '../src/bank.js';
import type { Connection } from '../src/domain.js';
export class TestStore implements Store {
  values = new Map<string, unknown>();
  attempts: number[] = [];
  async get<T>(key: string): Promise<T | null> { return (this.values.get(key) as T | undefined) ?? null; }
  async getVersioned<T>(key: string): Promise<{ value: T; version: string } | null> {
    const value = await this.get<T>(key);
    return value === null ? null : { value: structuredClone(value), version: JSON.stringify(value) };
  }
  async write(updates: Record<string, unknown | null>, guard?: { key: string; version: string }): Promise<boolean> {
    if (guard && JSON.stringify(this.values.get(guard.key)) !== guard.version) return false;
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) this.values.delete(key); else this.values.set(key, structuredClone(value));
    }
    return true;
  }
  async set(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async take<T>(key: string): Promise<T | null> { const value = await this.get<T>(key); this.values.delete(key); return value; }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async reserveAttempt(now: number): Promise<boolean> {
    this.attempts = this.attempts.filter(value => value > now - 86_400_000);
    if (this.attempts.length >= 4 || now - (this.attempts.at(-1) ?? -Infinity) < 21_600_000) return false;
    this.attempts.push(now); return true;
  }
}
export class TestBank implements Bank {
  configured = true;
  calls = 0;
  error: Error | null = null;
  async balances(): Promise<unknown[]> {
    this.calls++; if (this.error) throw this.error;
    return [{ balance_type: 'ITBD', balance_amount: { amount: '-17.13', currency: 'EUR' } }];
  }
  async institutions() { return [{ name: 'Caisse Normandie', country: 'FR', maximum_consent_validity: 180 * 86400 }]; }
  async authorize(_name: string, _state: string, _callback: string, _validSeconds: number) { return 'https://auth.enablebanking.com/ais/start'; }
  async session(): Promise<BankSession> { return { sessionId: 'new-session', expiresAt: '2027-01-01T00:00:00.000Z', accounts: [] }; }
  async revoke(): Promise<void> {}
}
export const connection: Connection = { sessionId: 'session', expiresAt: '2027-01-01T00:00:00.000Z', accounts: [{ uid: 'account', identificationHash: 'stable', label: 'Compte courant' }], selectedAccount: { uid: 'account', identificationHash: 'stable', label: 'Compte courant' }, needsReauth: false };

