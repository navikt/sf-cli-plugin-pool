export type PoolCleanOrgResult = {
  scratchOrgId: string;
  poolTag: string;
  status: string;
  deletionResult: 'deleted' | 'failed';
  error?: string;
};

export type PoolCleanResult = {
  orgs: PoolCleanOrgResult[];
  summary: {
    deleted: number;
    failed: number;
    total: number;
  };
};
