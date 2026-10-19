import type { Collections } from '../db/collections.js';
import type { CredentialDoc } from '../db/collections-esp02.js';
import { SEED_LABEL, seedIds } from '../db/seed-ids.js';
import { createDefaultProfile } from '../profiles/defaults.js';

/**
 * TEST ONLY: credentials with fake phones (+9890000000xx, unroutable) and default profiles for the seed principals.
 * Idempotent (upsert by fixed ids). Call after `seedDatabase`. Never run in production.
 */
export const SEED_PHONES: Record<string, string> = {
  [seedIds.admin]: '+989000000001',
  [seedIds.organizer]: '+989000000002',
  [seedIds.organizerB]: '+989000000003',
  [seedIds.referee]: '+989000000004',
  [seedIds.refereeB]: '+989000000005',
  [seedIds.captain]: '+989000000006',
  [seedIds.player]: '+989000000007',
  [seedIds.reporter]: '+989000000008',
  [seedIds.finance]: '+989000000009',
  [seedIds.finance2]: '+989000000010',
};

export async function seedIdentityDomain(c: Collections): Promise<void> {
  const now = new Date().toISOString();
  for (const [principalId, phone] of Object.entries(SEED_PHONES)) {
    const cred: CredentialDoc & { seedLabel?: string } = { _id: principalId, phone, phoneVerifiedAt: now, email: null, emailVerifiedAt: null, pendingEmail: null, passwordHash: null, totp: { enabled: false, secretEnc: null, pendingSecretEnc: null, recoveryCodeHashes: [], enabledAt: null }, phoneHistory: [], emailHistory: [], failedLogins: 0, lockedUntil: null, updatedAt: now, version: 0, seedLabel: SEED_LABEL };
    await c.credentials.updateOne({ _id: principalId }, { $setOnInsert: cred }, { upsert: true });
    const nick = `seed_${principalId.replace('usr_seed_', '')}`;
    await c.profiles.updateOne({ _id: principalId }, { $setOnInsert: { ...createDefaultProfile(principalId, nick), bio: SEED_LABEL } }, { upsert: true });
  }
}
