import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { fetchPoolOrg } from '../../lib/poolFetch.js';
import { PoolFetchResult } from '../../types/pool-fetch.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('pool', 'pool.fetch');

export default class PoolFetch extends SfCommand<PoolFetchResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-dev-hub': Flags.requiredHub(),
    'api-version': Flags.orgApiVersion(),
    'pool-tag': Flags.string({
      summary: messages.getMessage('flags.pool-tag.summary'),
      char: 't',
      required: true,
    }),
    'set-default': Flags.boolean({
      summary: messages.getMessage('flags.set-default.summary'),
    }),
    alias: Flags.string({
      summary: messages.getMessage('flags.alias.summary'),
      char: 'a',
    }),
  };

  public async run(): Promise<PoolFetchResult> {
    const { flags } = await this.parse(PoolFetch);

    const devhub = flags['target-dev-hub'];
    const connection = devhub.getConnection(flags['api-version']);
    const tag = flags['pool-tag'];
    const alias = flags.alias;
    const setDefault = flags['set-default'] ?? false;

    const logProgress = this.jsonEnabled() ? undefined : (msg: string): void => this.log(msg);

    this.spinner.start(messages.getMessage('info.spinner-start'));

    const result = await fetchPoolOrg(connection, tag, alias, setDefault, undefined, logProgress);

    this.spinner.stop(messages.getMessage('info.spinner-done'));

    if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.fetched', [result.username, result.poolTag]));
      if (result.instanceUrl) {
        this.log(messages.getMessage('info.instance-url', [result.instanceUrl]));
      }
      if (result.alias) {
        this.log(messages.getMessage('info.set-alias', [result.alias, result.username]));
      }
      if (result.isDefault) {
        this.log(messages.getMessage('info.set-default', [result.username]));
      }
      this.log();
    }

    return result;
  }
}
