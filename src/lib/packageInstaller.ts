import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connection, Logger, SfError, SfProject } from '@salesforce/core';
import { PackageDependency, PackageKeys } from '../types/package.js';

const logger = Logger.childFromRoot('packageInstaller');

const INSTALL_POLL_INTERVAL_MS = 5000;
const INSTALL_TIMEOUT_MS = 600_000;

type PackageInstallCreateResult = {
  id: string;
  success: boolean;
  errors: unknown[];
};

type PackageInstallStatusRecord = {
  Id: string;
  Status: string;
};

type SfProjectLike = Pick<SfProject, 'getPackageAliases' | 'getUniquePackageDirectories'>;

export async function resolveSfProject(sfdxProjectPath: string): Promise<SfProject> {
  return SfProject.resolve(sfdxProjectPath);
}

function parseVersionNumber(versionNumber: string): { major: number; minor: number; patch: number; build: string } {
  const parts = versionNumber.split('.');
  if (parts.length !== 4) {
    throw new SfError(
      `Invalid version number format: '${versionNumber}'. Expected Major.Minor.Patch.Build`,
      'InvalidVersionNumberError'
    );
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    throw new SfError(
      `Invalid version number format: '${versionNumber}'. Major, Minor, and Patch must be numbers`,
      'InvalidVersionNumberError'
    );
  }

  return {
    major,
    minor,
    patch,
    build: parts[3],
  };
}

function escapeSoqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function resolvePackageVersionId(
  devHubConnection: Connection,
  identifier: string,
  versionNumber?: string
): Promise<string> {
  let query = 'SELECT SubscriberPackageVersionId FROM Package2Version WHERE IsDeprecated = false';
  const escapedIdentifier = escapeSoqlString(identifier);

  if (identifier.startsWith('0Ho')) {
    query += ` AND Package2Id = '${escapedIdentifier}'`;
  } else {
    query += ` AND Package2.Name = '${escapedIdentifier}'`;
  }

  if (versionNumber) {
    const { major, minor, patch, build } = parseVersionNumber(versionNumber);
    query += ` AND MajorVersion = ${major} AND MinorVersion = ${minor} AND PatchVersion = ${patch}`;

    const normalizedBuild = build.toUpperCase();
    if (normalizedBuild === 'RELEASED') {
      query += ' AND IsReleased = true';
    } else if (normalizedBuild === 'LATEST') {
      // Intentionally no build/release filter; ORDER BY picks highest build.
    } else {
      const buildNumber = Number.parseInt(build, 10);
      if (Number.isNaN(buildNumber)) {
        throw new SfError(
          `Invalid version number format: '${versionNumber}'. Build must be RELEASED, LATEST, or a number`,
          'InvalidVersionNumberError'
        );
      }
      query += ` AND BuildNumber = ${buildNumber}`;
    }
  } else {
    query += ' AND IsReleased = true';
  }

  query += ' ORDER BY BuildNumber DESC LIMIT 1';

  logger.info('Resolving package version', { identifier, versionNumber });

  const result = await devHubConnection.tooling.query<{ SubscriberPackageVersionId: string }>(query);

  if (!result.records.length) {
    throw new SfError(
      `No package version found for '${identifier}'${versionNumber ? ` version ${versionNumber}` : ''}`,
      'PackageVersionNotFoundError'
    );
  }

  const subscriberPackageVersionId = result.records[0].SubscriberPackageVersionId;
  logger.info('Resolved package version', { identifier, subscriberPackageVersionId });
  return subscriberPackageVersionId;
}

async function resolvePackageId(
  alias: string,
  resolvedValue: string | undefined,
  versionNumber: string | undefined,
  devHubConnection: Connection
): Promise<string> {
  if (resolvedValue?.startsWith('04t')) {
    logger.info('Using 04t package version ID', { alias, packageId: resolvedValue });
    return resolvedValue;
  }

  if (resolvedValue?.startsWith('0Ho')) {
    logger.info('Resolving 0Ho Package2Id via DevHub', { alias, package2Id: resolvedValue });
    return resolvePackageVersionId(devHubConnection, resolvedValue, versionNumber);
  }

  if (resolvedValue) {
    logger.info('Resolving package by name via DevHub', { alias, name: resolvedValue });
    return resolvePackageVersionId(devHubConnection, resolvedValue, versionNumber);
  }

  if (alias.startsWith('04t')) {
    logger.info('Using direct 04t package version ID', { alias });
    return alias;
  }

  if (alias.startsWith('0Ho')) {
    logger.info('Resolving direct 0Ho Package2Id via DevHub', { alias });
    return resolvePackageVersionId(devHubConnection, alias, versionNumber);
  }

  logger.info('Resolving package by name via DevHub', { alias });
  return resolvePackageVersionId(devHubConnection, alias, versionNumber);
}

export async function extractDependencies(
  project: SfProjectLike,
  devHubConnection: Connection,
  packageKeys: PackageKeys = {}
): Promise<PackageDependency[]> {
  const aliases = project.getPackageAliases() ?? {};
  const packageDirs = project.getUniquePackageDirectories();

  const seen = new Set<string>();
  const dependencies: PackageDependency[] = [];

  for (const dir of packageDirs) {
    const dirDeps = (dir as { dependencies?: Array<{ package: string; versionNumber?: string }> }).dependencies ?? [];
    for (const dep of dirDeps) {
      const alias = dep.package;
      if (seen.has(alias)) continue;
      seen.add(alias);

      // eslint-disable-next-line no-await-in-loop
      const packageId = await resolvePackageId(alias, aliases[alias], dep.versionNumber, devHubConnection);

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
  sfdxProjectFile: string,
  devHubConnection: Connection,
  packageKeys: PackageKeys = {}
): Promise<PackageDependency[]> {
  logger.debug('Reading sfdx-project.json dependencies', { sfdxProjectFile });

  if (!fs.existsSync(sfdxProjectFile)) {
    throw new SfError(`sfdx-project.json not found at ${sfdxProjectFile}`, 'SfdxProjectNotFoundError');
  }

  const projectDir = path.dirname(sfdxProjectFile);
  const project = await resolveSfProject(projectDir);
  const dependencies = await extractDependencies(project, devHubConnection, packageKeys);
  logger.info(`Found ${dependencies.length} package(s) to install`);
  return dependencies;
}

export async function installPackage(
  targetOrgConnection: Connection,
  packageId: string,
  alias: string,
  installationKey?: string
): Promise<void> {
  logger.info('Installing package', { packageId, alias });

  const requestBody: Record<string, unknown> = {
    EnableRss: true,
    SubscriberPackageVersionKey: packageId,
    SecurityType: installationKey ? 'Full' : 'None',
    NameConflictResolution: 'Block',
  };
  if (installationKey) {
    requestBody.Password = installationKey;
  }

  let createResult: PackageInstallCreateResult;
  try {
    createResult = (await targetOrgConnection.tooling.create(
      'PackageInstallRequest',
      requestBody
    )) as unknown as PackageInstallCreateResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to submit install request for package '${alias}'. ${message}`, 'PackageInstallError');
  }

  const recordId = createResult.id;
  logger.debug('PackageInstallRequest created, polling for completion', { recordId });

  await pollInstallStatus(targetOrgConnection, recordId, alias);
}

async function pollInstallStatus(connection: Connection, recordId: string, alias: string): Promise<void> {
  const deadline = Date.now() + INSTALL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(INSTALL_POLL_INTERVAL_MS);

    let record: PackageInstallStatusRecord;
    try {
      // eslint-disable-next-line no-await-in-loop
      record = (await connection.tooling.retrieve('PackageInstallRequest', recordId)) as PackageInstallStatusRecord;
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
      logger.info('Package installed successfully', { alias, recordId });
      return;
    }

    if (status === 'ERROR' || status === 'FAILED') {
      logger.warn('Package installation failed', { alias, recordId, status });
      throw new SfError(`Package '${alias}' installation failed with status: ${status}`, 'PackageInstallError');
    }
  }

  logger.warn('Package installation timed out', { alias, recordId });
  throw new SfError(
    `Package '${alias}' installation timed out after ${INSTALL_TIMEOUT_MS / 1000}s`,
    'PackageInstallTimeoutError'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
