import * as path from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { loadPoolConfig, loadPackageKeys, loadPackageKeysFromString, preparePool } from '../../lib/poolPrepare.js';
import { PoolPrepareResult } from '../../types/pool-prepare.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('pool', 'pool.prepare');

export type PoolPrepareCommandResult = {
  pools: PoolPrepareResult[];
};

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

async function resolvePackageKeys(stdinFlag: boolean, keysFile?: string): Promise<ReturnType<typeof loadPackageKeys>> {
  if (stdinFlag) {
    const stdinData = await readStdin();
    return loadPackageKeysFromString(stdinData);
  }
  if (keysFile) return loadPackageKeys(keysFile);
  return loadPackageKeys();
}

export default class PoolPrepare extends SfCommand<PoolPrepareCommandResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-dev-hub': Flags.requiredHub(),
    'api-version': Flags.orgApiVersion(),
    'config-file': Flags.file({
      summary: messages.getMessage('flags.config-file.summary'),
      char: 'f',
      default: './config/pool-config.json',
      exists: true,
    }),
    'sfdx-project-path': Flags.directory({
      summary: messages.getMessage('flags.sfdx-project-path.summary'),
      char: 'p',
      exists: true,
    }),
    'package-keys-stdin': Flags.boolean({
      summary: messages.getMessage('flags.package-keys-stdin.summary'),
      exclusive: ['package-keys-file'],
    }),
    'package-keys-file': Flags.file({
      summary: messages.getMessage('flags.package-keys-file.summary'),
      exists: true,
    }),
    'keep-failed': Flags.boolean({
      summary: messages.getMessage('flags.keep-failed.summary'),
      default: false,
    }),
  };

  public async run(): Promise<PoolPrepareCommandResult> {
    const { flags } = await this.parse(PoolPrepare);

    const packageKeys = await resolvePackageKeys(flags['package-keys-stdin'] ?? false, flags['package-keys-file']);

    this.spinner.start(messages.getMessage('info.spinner-start'));
    const poolConfig = loadPoolConfig(flags['config-file']);
    const hubOrg = flags['target-dev-hub'];

    const results: PoolPrepareResult[] = [];

    /* eslint-disable no-await-in-loop */
    for (const poolDef of poolConfig.pools) {
      const sfdxProjectPath = flags['sfdx-project-path'] ?? poolDef.sfdxProjectFilePath ?? process.cwd();

      const result = await preparePool(
        hubOrg,
        poolDef,
        packageKeys,
        path.resolve(sfdxProjectPath),
        flags['keep-failed']
      );
      results.push(result);
    }
    /* eslint-enable no-await-in-loop */

    this.spinner.stop('Done');

    if (!this.jsonEnabled()) {
      this.styledHeader(messages.getMessage('info.header'));

      for (const r of results) {
        if (r.skipped) {
          this.log(messages.getMessage('info.pool-skipped', [r.tag, String(r.existing), String(r.requested)]));
        } else {
          this.log(
            messages.getMessage('info.pool-summary', [
              r.tag,
              String(r.created),
              String(r.failed),
              String(r.requested),
              String(r.existing),
            ])
          );
        }
      }

      this.log();
      this.log(messages.getMessage('info.complete'));
    }

    return { pools: results };
  }
}
