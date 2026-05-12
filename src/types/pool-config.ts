export type PoolDefinition = {
  tag: string;
  count: number;
  definitionFilePath: string;
  retryCount?: number;
  expirationDays?: number;
  sfdxProjectFile?: string;
};

export type PoolConfig = {
  pools: PoolDefinition[];
};
