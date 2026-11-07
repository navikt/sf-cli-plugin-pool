import type { AuthFields } from '@salesforce/core';

export type PoolAuthFields = AuthFields & {
  poolClaimToken?: string;
};
