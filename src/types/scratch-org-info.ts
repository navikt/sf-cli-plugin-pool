export type ScratchOrgInfoRow = {
  Id: string;
  Pool_allocation_status__c: string;
  Pool_tag__c: string | null;
  SignupUsername?: string | null;
  CreatedDate?: string;
  Sfdx_Auth_Url__c?: string | null;
  Pool_claim_token__c?: string | null;
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
