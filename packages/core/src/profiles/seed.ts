import type { Collections } from '../db/collections.js';
import { SEED_LABEL, seedIds } from '../db/seed-ids.js';

/**
 * TEST ONLY: two games on the seed player's profile and one follow (captain follows player).
 * Idempotent (fixed ids); call after seedDatabase + seedIdentityDomain. Never run in production.
 */
export async function seedProfilesDomain(c: Collections): Promise<void> {
  const now = new Date().toISOString();
  await c.profiles.updateOne(
    { _id: seedIds.player, games: { $size: 0 } },
    {
      $set: {
        games: [
          { gameId: 'game_seed_synthetic', roles: ['entry'], declaredLevel: 'advanced', verifiedLevel: null, equipment: null, activityHours: '20-24' },
          { gameId: 'game_seed_synthetic_2', roles: ['support'], declaredLevel: 'intermediate', verifiedLevel: null, equipment: null, activityHours: null },
        ],
        city: 'تهران',
        bio: SEED_LABEL,
      },
    },
  );
  await c.follows.updateOne({ _id: 'fol_seed_1' }, { $setOnInsert: { _id: 'fol_seed_1', followerId: seedIds.captain, targetType: 'player', targetId: seedIds.player, createdAt: now } }, { upsert: true });
}
