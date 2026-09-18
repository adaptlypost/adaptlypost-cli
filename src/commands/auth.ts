import type { Command } from 'commander';

import { listSocialAccounts } from '../api/client.js';
import type { SocialAccount } from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  configureHttp,
  credentialsPath,
  deleteAllProfiles,
  deleteProfile,
  describeTokenSource,
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
    .description('show which token is in use and what it can see')
    .action(async () => {
      const profile = resolveProfile();
      const { accounts } = await listSocialAccounts();
      const platforms = platformsOf(accounts);
      const rateLimit = getLastRateLimit();

      printResult(
        'whoami',
        {
          profile: profile.name,
          tokenPrefix: redactToken(profile.token),
          tokenSource: profile.tokenSource,
          apiUrl: profile.apiUrl,
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

      printKeyValues([
        ['profile', profile.name],
        ['token', `${redactToken(profile.token)} (from ${describeTokenSource(profile.tokenSource)})`],
        ['api', profile.apiUrl],
        [
          'workspace',
          `${accounts.length} connected ${accounts.length === 1 ? 'account' : 'accounts'}, ${platforms.length} ${
            platforms.length === 1 ? 'platform' : 'platforms'
          }`,
        ],
        ...(rateLimit?.remaining !== undefined && rateLimit.limit !== undefined
          ? [
              [
                'limits',
                `${rateLimit.remaining} of ${rateLimit.limit} requests left this minute`,
              ] as [string, string],
            ]
          : []),
      ]);
      hint('There is no /me endpoint, so this is read back from your connected accounts.');
    });
}
