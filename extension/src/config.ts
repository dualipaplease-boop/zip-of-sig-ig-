// Central configuration for the SentryAgent extension.
// Previously the reasoner URL was hardcoded in two places
// (content.ts and background.ts). Keep this the single source of truth.

export const REASONER_HOST = 'http://localhost:8000';
export const PLAN_ENDPOINT = '/api/v1/plan';
export const REASONER_PLAN_URL = `${REASONER_HOST}${PLAN_ENDPOINT}`;
