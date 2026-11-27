export type PoolDefinition = {
  tag: string;
  count: number;
  definitionFilePath: string;
  retryCount?: number;
  expirationDays?: number;
  sfdxProjectFile?: string;
  /** Maximum concurrent org preparations; defaults to 3 when omitted. */
  concurrency?: number;
};

export type PoolConfig = {
  pools: PoolDefinition[];
};
