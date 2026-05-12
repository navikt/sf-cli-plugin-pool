export type PackageKeys = Record<string, string>;

export type PackageDependency = {
  packageId: string;
  alias: string;
  installationKey?: string;
};
