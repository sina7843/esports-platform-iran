import type { ProfileDoc } from '../db/collections-esp02.js';

/** Default profile for a freshly created principal (USR-003). Privacy defaults follow ProfileFieldPrivacySchema. */
export function createDefaultProfile(principalId: string, nickname: string): ProfileDoc {
  const now = new Date().toISOString();
  return {
    _id: principalId,
    nickname,
    nicknameLower: nickname.toLowerCase(),
    realName: null,
    bio: null,
    province: null,
    city: null,
    links: [],
    avatarFileId: null,
    coverFileId: null,
    games: [],
    privacy: { realName: 'private', city: 'public', province: 'public', links: 'public', games: 'public', activityHours: 'followers', equipment: 'public', bio: 'public' },
    messagePolicy: 'everyone',
    notificationPrefs: { channels: { inApp: true, sms: true, email: false, push: false }, quietHours: null, promotional: false, digestFrequent: true },
    lookingForTeam: { active: false, resume: null, gameIds: [], since: null },
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}
