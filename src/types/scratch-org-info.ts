export type ScratchOrgInfoRow = {
  Id: string;
  Pool_allocation_status__c: string;
  Pool_tag__c: string | null;
  SignupUsername?: string | null;
  CreatedDate?: string;
  Sfdx_Auth_Url__c?: string | null;
  Pool_claim_token__c?: string | null;
};

export type CleanableOrgRow = {
  Id: string;
  ScratchOrgInfo: Pick<ScratchOrgInfoRow, 'Id' | 'Pool_allocation_status__c' | 'Pool_tag__c'>;
};

/**
 * A pool org candidate queried from `ActiveScratchOrg`, traversing up to its parent
 * `ScratchOrgInfo`. `Id` is the `ActiveScratchOrg` record Id (used to transfer its
 * ownership); the nested `ScratchOrgInfo` carries the fields used to claim the org.
 */
export type AvailableOrgRow = {
  Id: string;
  ScratchOrgInfo: {
    Id: string;
    Pool_allocation_status__c: string;
    Pool_tag__c: string | null;
    SignupUsername?: string | null;
    CreatedDate?: string;
    Sfdx_Auth_Url__c?: string | null;
  };
};

/**
 * A fetched org queried by `pool return` from `ActiveScratchOrg`, traversing up to its parent
 * `ScratchOrgInfo`. Carries ownership on both records and the parent's last-modified timestamp,
 * used to reject stale returns. `ScratchOrgInfo` is `null` if the parent can't be traversed.
 */
export type ReturnOrgRow = {
  Id: string;
  ScratchOrg: string;
  OwnerId: string;
  CreatedById: string | null;
  ScratchOrgInfo: {
    Id: string;
    SignupUsername: string | null;
    Status: string | null;
    Pool_tag__c: string | null;
    Pool_allocation_status__c: string | null;
    OwnerId: string;
    CreatedById: string | null;
    Pool_claim_token__c: string | null;
  } | null;
};
