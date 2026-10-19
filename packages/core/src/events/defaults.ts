import type { DisciplineConfig, EventConfig } from '../db/collections-esp03.js';

/**
 * Neutral defaults for event/discipline configuration. They contain no competitive rule values (age, roster size,
 * BO, deadlines…): those always come from the frozen rules package (RULE-009). Capacity 0 means "not configured";
 * publication refuses it.
 */
export function defaultEventConfig(): EventConfig {
  return {
    description: null,
    posterFileId: null,
    presence: 'online',
    regions: [],
    language: 'fa',
    contact: null,
    linkToken: null,
    publishAt: null,
    rated: false,
    prizes: [],
    refundPolicy: null,
    cancellationTerms: null,
    disputeTerms: null,
    isTemplate: false,
    duplicatedFrom: null,
    seasonId: null,
  };
}

export function defaultDisciplineConfig(): DisciplineConfig {
  return {
    rulesPackageId: null,
    participantKind: 'team',
    capacity: 0,
    minParticipants: 0,
    feeRial: 0,
    priceListId: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    lateRegistrationUntil: null,
    editDeadline: null,
    withdrawalDeadline: null,
    paymentWindowMinutes: 30,
    autoApprove: false,
    waitlistPolicy: 'fifo',
    quotas: [],
    formFields: [],
    requiredDocuments: [],
    checkin: null,
    seasonChangeCap: null,
    presence: 'online',
    regions: [],
  };
}
