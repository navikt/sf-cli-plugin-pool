import * as fs from 'node:fs';
import { Connection, Logger, SfError, SfProject, isPackagingDirectory } from '@salesforce/core';
import { PackageDependency, PackageKeys } from '../types/pool-prepare.js';

const logger = Logger.childFromRoot('packageInstaller');

const INSTALL_POLL_INTERVAL_MS = 5000;
const INSTALL_TIMEOUT_MS = 600_000;

type PackageInstallRecord = {
  Id: string;
  Status: string;
  SubscriberPackageVersionId: string;
};

type SfProjectLike = Pick<SfProject, 'getPackageAliases' | 'getUniquePackageDirectories'>;

export async function resolveSfProject(sfdxProjectPath: string): Promise<SfProject> {
  return SfProject.resolve(sfdxProjectPath);
}

export function extractDependencies(project: SfProjectLike, packageKeys: PackageKeys = {}): PackageDependency[] {
  const aliases = project.getPackageAliases() ?? {};
  const packageDirs = project.getUniquePackageDirectories();

  const seen = new Set<string>();
  const dependencies: PackageDependency[] = [];

  for (const dir of packageDirs) {
    if (!isPackagingDirectory(dir)) continue;
    for (const dep of dir.dependencies ?? []) {
      const alias = dep.package;
      if (seen.has(alias)) continue;
      seen.add(alias);

      const packageId = aliases[alias];
      if (!packageId) {
        throw new SfError(
          `Package alias '${alias}' not found in packageAliases of sfdx-project.json`,
          'PackageAliasNotFoundError'
        );
      }

      if (!packageId.startsWith('04t')) continue;

      dependencies.push({
        packageId,
        alias,
        installationKey: packageKeys[alias],
      });
    }
  }

  return dependencies;
}

export async function readSfdxProjectDependencies(
  sfdxProjectPath: string,
  packageKeys: PackageKeys = {}
): Promise<PackageDependency[]> {
  logger.debug('Reading sfdx-project.json dependencies', { sfdxProjectPath });

  const projectFile = `${sfdxProjectPath}/sfdx-project.json`;
  if (!fs.existsSync(projectFile)) {
    throw new SfError(`sfdx-project.json not found at ${projectFile}`, 'SfdxProjectNotFoundError');
  }

  const project = await resolveSfProject(sfdxProjectPath);
  const dependencies = extractDependencies(project, packageKeys);
  logger.debug(`Found ${dependencies.length} packages to install`);
  return dependencies;
}

export async function installPackage(
  targetOrgConnection: Connection,
  packageId: string,
  alias: string,
  installationKey?: string
): Promise<void> {
  logger.debug('Installing package', { packageId, alias });

  const requestBody: Record<string, unknown> = {
    EnableRss: true,
    SubscriberPackageVersionId: packageId,
    SecurityType: installationKey ? 'Full' : 'None',
  };
  if (installationKey) {
    requestBody.Password = installationKey;
  }

  let installRecord: PackageInstallRecord;
  try {
    installRecord = (await targetOrgConnection.tooling.create(
      'PackageInstallRequest',
      requestBody
    )) as unknown as PackageInstallRecord;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to submit install request for package '${alias}'. ${message}`, 'PackageInstallError');
  }

  const recordId = installRecord.Id;
  logger.debug('PackageInstallRequest created, polling for completion', { recordId });

  await pollInstallStatus(targetOrgConnection, recordId, alias);
}

async function pollInstallStatus(connection: Connection, recordId: string, alias: string): Promise<void> {
  const deadline = Date.now() + INSTALL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(INSTALL_POLL_INTERVAL_MS);

    let record: PackageInstallRecord;
    try {
      // eslint-disable-next-line no-await-in-loop
      record = (await connection.tooling.retrieve('PackageInstallRequest', recordId)) as PackageInstallRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SfError(
        `Failed to poll install status for package '${alias}' (request ${recordId}). ${message}`,
        'PackageInstallError'
      );
    }

    const status = record.Status;
    logger.debug('Package install status', { alias, recordId, status });

    if (status === 'SUCCESS') {
      logger.debug('Package installed successfully', { alias });
      return;
    }

    if (status === 'ERROR' || status === 'FAILED') {
      throw new SfError(`Package '${alias}' installation failed with status: ${status}`, 'PackageInstallError');
    }
  }

  throw new SfError(
    `Package '${alias}' installation timed out after ${INSTALL_TIMEOUT_MS / 1000}s`,
    'PackageInstallTimeoutError'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
