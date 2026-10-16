import { z } from 'zod';

export const balanceSchema = z.object({
  balance_type: z.string(),
  balance_amount: z.object({ amount: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/), currency: z.literal('EUR') }),
  reference_date: z.string().optional(),
});
export type BalanceKind = 'booked' | 'available';
export type BalanceStatus = 'ready' | 'stale' | 'reconnect_required' | 'not_connected' | 'error';
export interface Snapshot {
  amount: string | null;
  currency: string;
  accountLabel: string;
  balanceKind: BalanceKind | null;
  fetchedAt: string | null;
  sourceDate: string | null;
  consentExpiresAt: string | null;
  status: BalanceStatus;
}
export interface Account {
  uid: string;
  identificationHash: string;
  label: string;
}
export interface Connection {
  sessionId: string;
  expiresAt: string;
  accounts: Account[];
  selectedAccount: Account | null;
  needsReauth: boolean;
}

export function selectBalance(values: unknown[]): Pick<Snapshot, 'amount' | 'currency' | 'balanceKind' | 'sourceDate'> {
  const parsed = values.map(value => balanceSchema.safeParse(value)).filter(result => result.success).map(result => result.data);
  // Ne pas présenter un solde prévisionnel comme une disponibilité réelle.
  for (const type of ['ITBD', 'CLBD', 'ITAV', 'CLAV']) {
    const entry = parsed.find(value => value.balance_type === type);
    if (entry) return { amount: entry.balance_amount.amount, currency: entry.balance_amount.currency,
      balanceKind: type.endsWith('BD') ? 'booked' : 'available', sourceDate: entry.reference_date ?? null };
  }
  throw new Error('Aucun solde EUR exploitable.');
}

export function emptySnapshot(): Snapshot {
  return { amount: null, currency: 'EUR', accountLabel: 'Compte courant', balanceKind: null,
    fetchedAt: null, sourceDate: null, consentExpiresAt: null, status: 'not_connected' };
}

export function snapshotState(snapshot: Snapshot, now: number): Snapshot {
  if ((snapshot.status === 'ready' || snapshot.status === 'stale') && snapshot.fetchedAt && now - Date.parse(snapshot.fetchedAt) >= 8 * 3_600_000)
    return { ...snapshot, status: 'stale' };
  return snapshot;
}
