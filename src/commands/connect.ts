import type { Command } from 'commander';

import { createConnectLink, revokeConnectLink } from '../api/client.js';
import type { ConnectLink, CreateConnectLinkRequest, PlatformType } from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  assertTimeZone,
  formatAbsolute,
  formatRelative,
  hint,
  isMachine,
  parseWhen,
  printKeyValues,
  printResult,
  profileDefaults,
  promptConfirm,
  success,
  toIso,
  usageError,
} from '../core/index.js';
import { normalizePlatform } from './account.js';

interface GlobalOptions {
  yes?: boolean;
}

export interface ConnectCreateOptions {
  name?: string;
  private?: boolean;
  platform?: PlatformType[];
  maxAccounts?: string;
  expires?: string;
  neverExpires?: boolean;
  timezone?: string;
}

const collectPlatform = (value: string, previous: PlatformType[]): PlatformType[] => [
  ...previous,
  normalizePlatform(value),
];

const parseMaxAccounts = (value: string): number => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw usageError(`--max-accounts "${value}" is not a whole number of 1 or more`);
  }
  return count;
};

const parseExpiry = (value: string, timezone: string): string => {
  try {
    return toIso(parseWhen(value, { timezone }));
  } catch {
    throw usageError(
      `--expires "${value}" is not a date`,
      'use an ISO 8601 date-time such as 2026-11-30T18:00:00Z, a local time such as 2026-11-30 18:00, or an offset such as +30d',
    );
  }
};

export const toCreateConnectLinkRequest = (options: ConnectCreateOptions): CreateConnectLinkRequest => {
  if (options.expires !== undefined && options.neverExpires) {
    throw usageError('Pass either --expires or --never-expires, not both');
  }

  const timezone = assertTimeZone(options.timezone ?? profileDefaults().timezone ?? 'UTC');
  const platforms = [...new Set(options.platform ?? [])];

  return {
    ...(options.name !== undefined && { name: options.name }),
    ...(options.private && { visibility: 'PRIVATE' }),
    ...(platforms.length > 0 && { allowedPlatforms: platforms }),
    ...(options.maxAccounts !== undefined && { maxAccounts: parseMaxAccounts(options.maxAccounts) }),
    ...(options.expires !== undefined && { expiresAt: parseExpiry(options.expires, timezone) }),
    ...(options.neverExpires && { neverExpires: true }),
  };
};

const expiryOf = (link: ConnectLink): string => {
  if (link.expiresAt === null) return 'never';
  const date = new Date(link.expiresAt);
  return Number.isNaN(date.getTime())
    ? link.expiresAt
    : `${formatAbsolute(date)} (${formatRelative(date)})`;
};

async function runCreate(options: ConnectCreateOptions): Promise<void> {
  const link = await createConnectLink(toCreateConnectLinkRequest(options));

  if (isMachine()) {
    printResult('connect.create', link);
    return;
  }

  success('Connect link created');
  printKeyValues([
    ['url', link.url],
    ['token', link.token],
    ['name', link.name || '—'],
    ['visibility', (link.visibility ?? 'PUBLIC').toLowerCase()],
    ['platforms', link.allowedPlatforms?.length ? link.allowedPlatforms.join(', ') : 'all'],
    ['max accounts', link.maxAccounts ? String(link.maxAccounts) : 'no limit'],
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
    .option('--name <name>', 'Label shown in the dashboard list of links')
    .option('--private', 'Show the client only the accounts they connect through this link')
    .option('--platform <platform>', 'Platform the client can connect, repeatable. Leave out for every platform', collectPlatform, [])
    .option('--max-accounts <n>', 'Stop the link once this many accounts are connected through it')
    .option('--expires <when>', 'When the link stops working, 1 hour to 365 days away. Defaults to 7 days')
    .option('--never-expires', 'Keep the link working until it is revoked')
    .option('--timezone <tz>', 'IANA timezone for a local --expires time')
    .action(async (options: ConnectCreateOptions) => {
      await runCreate(options);
    });

  connect
    .command('revoke <token>')
    .alias('rm')
    .description('Revoke a connect link so it can no longer be used')
    .action(async (token: string, _options: GlobalOptions, command: Command) => {
      await runRevoke(token, command.optsWithGlobals() as GlobalOptions);
    });
}
