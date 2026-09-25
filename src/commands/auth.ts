import type { Command } from 'commander';

import { getMe, listSocialAccounts } from '../api/client.js';
import type { Me, SocialAccount } from '../api/types.js';
import {
  ApiError,
  CliError,
  ExitCode,
  PRODUCT,
  configureHttp,
  credentialsPath,
  deleteAllProfiles,
  deleteProfile,
  describeTokenSource,
  formatTimestamp,
  getGlobalOptions,
  getLastRateLimit,
  getProfile,
  hint,
  isDebugEnabled,
  listProfiles,
  openUrl,
  print,
  printKeyValues,
  printResult,
  profileDefaults,
  promptConfirm,
  promptHidden,
  redactToken,
  resolveApiUrl,
  resolveLanguage,
  resolveProfile,
  resolveProfileName,
  type GlobalOptions,
  saveProfile,
  success,
} from '../core/index.js';

const TOKEN_PREFIX = PRODUCT.tokenPrefixes[0];

function platformsOf(accounts: readonly SocialAccount[]): string[] {
  return [...new Set(accounts.map((account) => account.platform))].sort();
}

export function describeAbilities(can: Me['can']): string {
  const abilities = [can.draft && 'draft', can.schedule && 'schedule', can.publish && 'publish'].filter(
    (entry): entry is string => typeof entry === 'string',
  );
  return abilities.length === 0 ? 'read only' : abilities.join(', ');
}

function describeWorkspace(me: Me): string {
  return me.workspace.name ? `${me.workspace.name} (${me.workspace.id})` : me.workspace.id;
}

function describeRole(me: Me): string {
  const issued = me.issuerRole && me.issuerRole !== me.role.key ? `, key issued by ${me.issuerRole}` : '';
  return `${me.role.name} (${me.role.key}${issued})`;
}

async function readMe(): Promise<Me | null> {
  try {
    return await getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export function assertTokenShape(token: string): void {
  if (PRODUCT.tokenPrefixes.some((prefix) => token.startsWith(prefix))) return;
  if (token.split('.').length === 3) {
    throw new CliError('That looks like an OAuth JWT, not an API token.', {
      exitCode: ExitCode.AUTH,
      code: 'unsupported_token',
      hint: `OAuth login is not supported yet. Create an API token at ${PRODUCT.tokensUrl}`,
    });
  }
  const underscore = token.indexOf('_');
  const seen = underscore > 0 ? token.slice(0, underscore + 1) : '';
  throw new CliError(
    seen
      ? `That token starts with ${seen}. ${PRODUCT.binName} expects ${TOKEN_PREFIX}.`
      : `That does not look like an ${PRODUCT.displayName} API token, which starts with ${TOKEN_PREFIX}.`,
    {
      exitCode: ExitCode.AUTH,
      code: 'wrong_token_prefix',
      hint: `Create one at ${PRODUCT.tokensUrl}`,
    },
  );
}

async function collectToken(useStdin: boolean, globals: GlobalOptions): Promise<string> {
  if (useStdin) {
    const piped = (await readStdin()).trim();
    if (piped === '') {
      throw new CliError('Nothing arrived on stdin.', {
        exitCode: ExitCode.USAGE,
        code: 'empty_stdin',
        hint: `echo "$${PRODUCT.envPrefix}_API_TOKEN" | ${PRODUCT.binName} login --token-stdin`,
      });
    }
    return piped;
  }
  if (globals.token && globals.token.trim() !== '') return globals.token.trim();
  return (
    await promptHidden(`Token (starts with ${TOKEN_PREFIX})`, {
      hint: `Pass --token-stdin and pipe the token in, or set ${PRODUCT.envPrefix}_API_TOKEN`,
    })
  ).trim();
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description(`store an ${PRODUCT.displayName} API token on this machine`)
    .option('--token-stdin', 'read the token from stdin instead of prompting')
    .option('--name <label>', 'human label stored with the profile')
    .action(async (options: { tokenStdin?: boolean; name?: string }) => {
      const globals = getGlobalOptions();
      const name = resolveProfileName();
      const stored = getProfile(name);
      const apiUrl = resolveApiUrl(globals, stored?.apiUrl).url;

      if (!options.tokenStdin && !globals.token) {
        hint(`Opening ${PRODUCT.tokensUrl} in your browser.`);
        hint('Create a token, then paste it here.');
        openUrl(PRODUCT.tokensUrl);
      }

      const token = await collectToken(Boolean(options.tokenStdin), globals);
      assertTokenShape(token);

      configureHttp({
        profile: { name, token, tokenSource: 'flag', apiUrl, defaults: profileDefaults(name) },
        debug: isDebugEnabled(),
        language: resolveLanguage(),
        quiet: globals.quiet === true,
      });

      const { accounts } = await listSocialAccounts();
      const platforms = platformsOf(accounts);

      saveProfile(name, { token, apiUrl, label: options.name }, { makeCurrent: true });

      printResult('login', {
        profile: name,
        apiUrl,
        tokenPrefix: redactToken(token),
        label: options.name ?? null,
        accounts: accounts.length,
        platforms,
        credentialsPath: credentialsPath(),
      });

      success('Token valid');
      printKeyValues([
        ['profile', name],
        ...(options.name ? [['label', options.name] as [string, string]] : []),
        ['api', apiUrl],
        ['accounts', `${accounts.length} connected`],
        ...(platforms.length > 0 ? [['platforms', platforms.join(', ')] as [string, string]] : []),
        ['stored in', `${credentialsPath()} (0600)`],
      ]);
    });

  program
    .command('logout')
    .description('remove a stored token')
    .option('--all', 'remove every profile')
    .action(async (options: { all?: boolean }) => {
      const globals = getGlobalOptions();
      const profiles = listProfiles();

      if (profiles.length === 0) {
        throw new CliError('There are no stored profiles to remove.', {
          exitCode: ExitCode.NOT_FOUND,
          code: 'no_profiles',
          hint: `${PRODUCT.binName} login`,
        });
      }

      const name = resolveProfileName();
      const targets = options.all ? profiles.map((entry) => entry.name) : [name];

      if (!options.all && !profiles.some((entry) => entry.name === name)) {
        throw new CliError(`No profile named "${name}".`, {
          exitCode: ExitCode.NOT_FOUND,
          code: 'unknown_profile',
          hint: `Stored profiles: ${profiles.map((entry) => entry.name).join(', ')}`,
        });
      }

      const confirmed = await promptConfirm(
        options.all ? `Remove all ${targets.length} profiles?` : `Remove profile "${name}"?`,
        { assumeYes: globals.yes === true, initialValue: false },
      );
      if (!confirmed) {
        print('Nothing removed.');
        return;
      }

      if (options.all) deleteAllProfiles();
      else deleteProfile(name);

      printResult('logout', { removed: targets });
      print(options.all ? `Removed all ${targets.length} profiles.` : `Removed profile "${name}".`);
      print(`The token is still valid, revoke it at ${PRODUCT.tokensUrl}`);
    });

  program
    .command('whoami')
    .description('show which token is in use, its workspace, its role and what it can do')
    .action(async () => {
      const profile = resolveProfile();
      const me = await readMe();
      const { accounts } = await listSocialAccounts();
      const platforms = platformsOf(accounts);
      const rateLimit = getLastRateLimit();
      const expiresAt = me?.expiresAt ? new Date(me.expiresAt) : null;

      printResult(
        'whoami',
        {
          profile: profile.name,
          tokenPrefix: redactToken(profile.token),
          tokenSource: profile.tokenSource,
          apiUrl: profile.apiUrl,
          ...(me && {
            tokenType: me.tokenType,
            tokenName: me.tokenName,
            workspace: me.workspace,
            organizationId: me.organizationId,
            role: me.role,
            issuerRole: me.issuerRole,
            permissions: me.permissions,
            can: me.can,
            summary: me.summary,
            expiresAt: me.expiresAt,
          }),
          accounts: accounts.length,
          platforms,
        },
        rateLimit?.limit !== undefined && rateLimit.remaining !== undefined
          ? {
              rateLimit: {
                limit: rateLimit.limit,
                remaining: rateLimit.remaining,
                resetSeconds: rateLimit.reset ?? 0,
              },
            }
          : undefined,
      );

      const tokenLabel = me?.tokenName ? `"${me.tokenName}", ` : '';
      printKeyValues([
        ['profile', profile.name],
        ['token', `${redactToken(profile.token)} (${tokenLabel}from ${describeTokenSource(profile.tokenSource)})`],
        ['api', profile.apiUrl],
        ...(me
          ? ([
              ['workspace', describeWorkspace(me)],
              ['role', describeRole(me)],
              ['can', describeAbilities(me.can)],
            ] as Array<[string, string]>)
          : []),
        [
          'accounts',
          `${accounts.length} connected ${accounts.length === 1 ? 'account' : 'accounts'}, ${platforms.length} ${
            platforms.length === 1 ? 'platform' : 'platforms'
          }`,
        ],
        ...(expiresAt ? [['expires', formatTimestamp(expiresAt)] as [string, string]] : []),
        ...(rateLimit?.remaining !== undefined && rateLimit.limit !== undefined
          ? [
              [
                'limits',
                `${rateLimit.remaining} of ${rateLimit.limit} requests left this minute`,
              ] as [string, string],
            ]
          : []),
      ]);
      if (me && !me.can.publish) {
        hint(
          me.can.draft
            ? 'This key can save drafts but cannot schedule or publish. Ask a workspace admin for a key with the editor or admin role if it should.'
            : 'This key is read only. Ask a workspace admin for a key with a role that can create posts if it should.',
        );
      }
    });
}
