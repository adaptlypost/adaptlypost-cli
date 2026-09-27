import type { Command } from 'commander';

import { createConnectLink, revokeConnectLink } from '../api/client.js';
import type { ConnectLink } from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  formatAbsolute,
  formatRelative,
  hint,
  isMachine,
  printKeyValues,
  printResult,
  promptConfirm,
  success,
} from '../core/index.js';

interface GlobalOptions {
  yes?: boolean;
}

const expiryOf = (link: ConnectLink): string => {
  const date = new Date(link.expiresAt);
  return Number.isNaN(date.getTime())
    ? link.expiresAt
    : `${formatAbsolute(date)} (${formatRelative(date)})`;
};

async function runCreate(): Promise<void> {
  const link = await createConnectLink();

  if (isMachine()) {
    printResult('connect.create', link);
    return;
  }

  success('Connect link created');
  printKeyValues([
    ['url', link.url],
    ['token', link.token],
    ['expires', expiryOf(link)],
  ]);
  hint(`Send the url to the person who owns the accounts. Revoke it with: ${PRODUCT.binName} connect revoke ${link.token}`);
}

async function runRevoke(token: string, options: GlobalOptions): Promise<void> {
  const proceed = await promptConfirm(
    `Revoke connect link ${token}? Anyone holding it can no longer connect accounts with it.`,
    { assumeYes: Boolean(options.yes) },
  );
  if (!proceed) {
    throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
  }

  const revoked = await revokeConnectLink(token);

  if (isMachine()) {
    printResult('connect.revoke', revoked);
    return;
  }

  success('Connect link revoked');
}

export function registerConnectCommands(program: Command): void {
  const connect = program
    .command('connect')
    .description('Links that let a client connect their own social accounts to this workspace');

  connect
    .command('create')
    .description('Create a connect link')
    .action(async () => {
      await runCreate();
    });

  connect
    .command('revoke <token>')
    .alias('rm')
    .description('Revoke a connect link so it can no longer be used')
    .action(async (token: string, _options: GlobalOptions, command: Command) => {
      await runRevoke(token, command.optsWithGlobals() as GlobalOptions);
    });
}
