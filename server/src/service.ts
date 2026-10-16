import type { Bank } from './bank.js';
import { BankError } from './bank.js';
import type { Store } from './store.js';
import type { Connection, Snapshot } from './domain.js';
import { emptySnapshot, selectBalance, snapshotState } from './domain.js';

export class BalanceService {
  constructor(private readonly store: Store, private readonly bank: Bank, private readonly clock = Date.now) {}
  async balance(): Promise<Snapshot> {
    const now = this.clock();
    const versioned = await this.store.getVersioned<Connection>('connection');
    if (!versioned) return emptySnapshot();
    const connection = versioned.value;
    const guard = { key: 'connection', version: versioned.version };
    const saved = await this.store.get<{ sessionId: string; accountId: string; snapshot: Snapshot }>('snapshot');
    const previous = saved?.sessionId === connection.sessionId && saved.accountId === connection.selectedAccount?.uid ? saved.snapshot : emptySnapshot();
    const cached = { ...previous, consentExpiresAt: connection.expiresAt, accountLabel: connection.selectedAccount?.label ?? 'Compte courant' };
    if (connection.needsReauth || Date.parse(connection.expiresAt) <= now) return { ...cached, status: 'reconnect_required' };
    if (!connection.selectedAccount) return { ...emptySnapshot(), consentExpiresAt: connection.expiresAt };
    const blockedUntil = (await this.store.get<number>('blocked-until')) ?? 0;
    if (blockedUntil > now || !await this.store.reserveAttempt(now)) return snapshotState(cached, now);
    try {
      const selected = selectBalance(await this.bank.balances(connection.selectedAccount.uid));
      // Une réponse d'une ancienne session ne doit pas ressusciter une déconnexion.
      const snapshot: Snapshot = { ...cached, ...selected, fetchedAt: new Date(now).toISOString(), status: 'ready' };
      const saved = await this.store.write({ snapshot: { sessionId: connection.sessionId, accountId: connection.selectedAccount.uid, snapshot } }, guard);
      return saved ? snapshot : emptySnapshot();
    } catch (error) {
      const current = await this.store.get<Connection>('connection');
      if (current?.sessionId !== connection.sessionId || current.selectedAccount?.uid !== connection.selectedAccount?.uid) return emptySnapshot();
      if (error instanceof BankError && error.kind === 'reconnect') {
        const saved = await this.store.write({ connection: { ...connection, needsReauth: true } }, guard);
        return saved ? { ...cached, status: 'reconnect_required' } : emptySnapshot();
      }
      if (error instanceof BankError && error.retryAfterSeconds > 0) await this.store.set('blocked-until', now + error.retryAfterSeconds * 1000);
      const failed = snapshotState({ ...cached, status: cached.fetchedAt ? 'stale' : 'error' }, now);
      const saved = await this.store.write({ snapshot: { sessionId: connection.sessionId, accountId: connection.selectedAccount.uid, snapshot: failed } }, guard);
      return saved ? failed : emptySnapshot();
    }
  }
}
