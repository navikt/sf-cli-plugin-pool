export type PoolReturnResult = {
  username: string;
  /** `ScratchOrgInfo` record Id, matching the meaning of `orgId` in the `pool fetch` result. */
  orgId: string;
  activeScratchOrgId: string;
  poolTag: string;
  /** Restored owner of the `ScratchOrgInfo` record (its creator). */
  scratchOrgInfoOwnerId: string;
  /** Restored owner of the `ActiveScratchOrg` record (its creator). */
  activeScratchOrgOwnerId: string;
  status: 'available';
  /** `false` when the Dev Hub return succeeded but local auth cleanup failed; see `warnings`. */
  localAuthRemoved: boolean;
  warnings: string[];
};
