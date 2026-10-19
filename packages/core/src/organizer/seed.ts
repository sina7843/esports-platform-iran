import type { Acl } from '../acl/acl.js';
import type { Collections } from '../db/collections.js';
import { SEED_LABEL, seedIds } from '../db/seed-ids.js';

/** TEST ONLY: approved organizer profile for org_seed_a (level basic, small limits). The seed organizer already holds an `organizer` grant on org A. Idempotent. */
export async function seedOrganizerDomain(c: Collections, _acl: Acl): Promise<void> {
  const t = new Date().toISOString();
  await c.organizerProfiles.updateOne(
    { _id: seedIds.orgA },
    {
      $setOnInsert: {
        _id: seedIds.orgA,
        verified: { state: 'verified', issuer: seedIds.admin, at: t, expiresAt: null, note: SEED_LABEL },
        level: 'basic',
        limits: { maxActiveEvents: 2, maxCapacityPerEvent: 64, paidEventsAllowed: false },
        prizeGuarantee: false,
        intro: `${SEED_LABEL}`,
        staff: [],
        venue: null,
        venueAddressText: null,
        facilities: [],
        links: [],
        sponsors: [],
        createdAt: t,
        updatedAt: t,
        version: 0,
      },
    },
    { upsert: true },
  );
}
