import { ConfigAggregator, Lifecycle, Logger, Messages, Org, OrgConfigProperties } from '@salesforce/core';
import type { SfDoctor } from '@salesforce/plugin-info';
import { checkFieldAccess, FIELD_NAMES, type FieldCheckResult, type PoolDoctorField } from '../lib/poolDoctor.js';

type HookFunction = (options: { doctor: SfDoctor }) => Promise<void>;

const pluginName = '@navikt/sf-cli-plugin-pool';

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('sf-cli-plugin-pool-diagnostics');
  }
  return logger;
};

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(pluginName, 'diagnostics');

export const hook: HookFunction = async (options) => {
  getLogger().debug(`Running sf doctor diagnostics for ${pluginName}`);

  const connection = await checkDevHub(options.doctor);

  await Promise.all(FIELD_NAMES.map((fieldName) => checkField(options.doctor, fieldName, connection)));
};

// ---------------------------------------------------------------------------
// Diagnostic: default DevHub is configured and reachable
// Returns the connection if successful, undefined otherwise.
// ---------------------------------------------------------------------------
async function checkDevHub(doctor: SfDoctor): Promise<Awaited<ReturnType<Org['getConnection']>> | undefined> {
  const testName = `[${pluginName}] default DevHub configured`;
  getLogger().debug('Running DevHub configuration check');

  try {
    const aggregator = await ConfigAggregator.create();
    const targetDevHub = aggregator.getPropertyValue<string>(OrgConfigProperties.TARGET_DEV_HUB);

    if (!targetDevHub) {
      doctor.addPluginData(pluginName, { targetDevHub: null });
      doctor.addSuggestion(messages.getMessage('suggestion.no-devhub'));
      void Lifecycle.getInstance().emit('Doctor:diagnostic', { testName, status: 'warn' });
      return undefined;
    }

    const org = await Org.create({ aliasOrUsername: targetDevHub, aggregator });
    const connection = org.getConnection();

    doctor.addPluginData(pluginName, { targetDevHub: org.getUsername() ?? targetDevHub });
    void Lifecycle.getInstance().emit('Doctor:diagnostic', { testName, status: 'pass' });
    return connection;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    getLogger().debug(`DevHub check failed: ${errMsg}`);
    doctor.addPluginData(pluginName, { targetDevHub: null, error: errMsg });
    doctor.addSuggestion(messages.getMessage('suggestion.no-devhub'));
    void Lifecycle.getInstance().emit('Doctor:diagnostic', { testName, status: 'warn' });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Diagnostic: individual ScratchOrgInfo custom field is accessible
// ---------------------------------------------------------------------------
async function checkField(
  doctor: SfDoctor,
  fieldName: PoolDoctorField,
  connection: Awaited<ReturnType<Org['getConnection']>> | undefined,
): Promise<void> {
  const testName = `[${pluginName}] field ${fieldName} is accessible`;
  getLogger().debug(`Running field access check: ${fieldName}`);

  if (!connection) {
    doctor.addPluginData(pluginName, { [fieldName]: 'unknown' });
    void Lifecycle.getInstance().emit('Doctor:diagnostic', { testName, status: 'unknown' });
    return;
  }

  try {
    const result = await checkFieldAccess(connection, fieldName);
    const fieldResults: Record<string, FieldCheckResult> = { [fieldName]: result };
    doctor.addPluginData(pluginName, fieldResults);

    if (result === 'fail') {
      doctor.addSuggestion(messages.getMessage('suggestion.field-missing'));
    }
    void Lifecycle.getInstance().emit('Doctor:diagnostic', { testName, status: result });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    getLogger().debug(`Field check error for ${fieldName}: ${errMsg}`);
    doctor.addPluginData(pluginName, { [fieldName]: 'unknown', error: errMsg });
    void Lifecycle.getInstance().emit('Doctor:diagnostic', { testName, status: 'unknown' });
  }
}

export { FIELD_NAMES };
