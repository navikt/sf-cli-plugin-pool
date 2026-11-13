import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { returnPoolOrg } from '../../lib/poolReturn.js';
import { PoolReturnResult } from '../../types/pool-return.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@navikt/sf-cli-plugin-pool', 'pool.return');

export default class PoolReturn extends SfCommand<PoolReturnResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'target-dev-hub': Flags.requiredHub(),
    'api-version': Flags.orgApiVersion(),
  };

  public async run(): Promise<PoolReturnResult> {
    const { flags } = await this.parse(PoolReturn);

    const connection = flags['target-dev-hub'].getConnection(flags['api-version']);
    const logProgress = this.jsonEnabled() ? undefined : (msg: string): void => this.log(msg);

    this.spinner.start(messages.getMessage('info.spinner-start'));

    let result: PoolReturnResult;
    try {
      result = await returnPoolOrg(connection, flags['target-org'], undefined, logProgress);
    } catch (error) {
      this.spinner.stop(messages.getMessage('info.spinner-failed'));
      throw error;
    }

    this.spinner.stop(messages.getMessage('info.spinner-done'));

    if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.returned', [result.username, result.poolTag]));
      if (result.localAuthRemoved) {
        this.log(messages.getMessage('info.local-auth-removed', [result.username]));
      }
    }
    result.warnings.forEach((warning) => this.warn(warning));

    return result;
  }
}
