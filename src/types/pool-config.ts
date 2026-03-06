export type PoolDefinition = {
  tag: string;
  count: number;
  definitionFilePath: string;
  retryCount?: number;
  expirationDays?: number;
};

export type PoolConfig = {
  pools: PoolDefinition[];
};
