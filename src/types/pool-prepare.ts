export type PoolPrepareResult = {
  tag: string;
  requested: number;
  existing: number;
  created: number;
  failed: number;
  skipped: boolean;
  errors: string[];
};

export type PackageKeys = Record<string, string>;

export type PackageDependency = {
  packageId: string;
  alias: string;
  installationKey?: string;
};

export type OrgCreateOutcome = {
  orgId: string;
  username: string;
};
