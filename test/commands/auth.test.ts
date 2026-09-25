import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Me, SocialAccount } from '../../src/api/types.js';
import type { ResolvedProfile, StoredProfile } from '../../src/core/index.js';

const EDITOR_ME: Me = {
  tokenType: 'api_token',
  tokenId: 'tok_1',
  tokenName: 'CI deploy',
  workspace: { id: 'ws_1', name: 'Acme' },
  organizationId: 'org_1',
  role: { key: 'editor', name: 'Editor' },
  issuerRole: 'admin',
  permissions: ['posts.read', 'posts.draft', 'posts.schedule', 'posts.publish'],
  can: { draft: true, schedule: true, publish: true },
  summary: 'Editor: creates, schedules and publishes posts',
  expiresAt: null,
};

const state = vi.hoisted(() => ({
  globals: {} as Record<string, unknown>,
  profile: {} as ResolvedProfile,
  stored: {} as Record<string, StoredProfile>,
  me: {} as Me | null,
  accounts: [] as SocialAccount[],
  rateLimit: undefined as { limit?: number; remaining?: number; reset?: number } | undefined,
  confirmed: true,
  typed: '',
  opened: [] as string[],
  httpConfigured: [] as unknown[],
  saved: [] as Array<{ name: string; input: Record<string, unknown> }>,
  deleted: [] as string[],
  deletedAll: 0,
}));

vi.mock('../../src/api/client.js', async () => {
  const { ApiError } = await import('../../src/core/errors.js');
  return {
    getMe: async () => {
      if (state.me === null) throw new ApiError({ status: 404, method: 'GET', path: '/me' });
      return state.me;
    },
    listSocialAccounts: async () => ({ accounts: state.accounts }),
  };
});

vi.mock('../../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/index.js')>();
  return {
    ...actual,
    configureHttp: (options: unknown) => {
      state.httpConfigured.push(options);
    },
    getGlobalOptions: () => state.globals,
    getLastRateLimit: () => state.rateLimit,
    getProfile: (name: string) => state.stored[name],
    isDebugEnabled: () => false,
    listProfiles: () =>
      Object.keys(state.stored).map((name) => ({ name, current: name === 'default' })),
    openUrl: (url: string) => {
      state.opened.push(url);
      return true;
    },
    profileDefaults: () => ({}),
    promptConfirm: async (_message: string, options: { assumeYes?: boolean } = {}) =>
      options.assumeYes === true ? true : state.confirmed,
    promptHidden: async () => state.typed,
    resolveApiUrl: () => ({ url: 'https://post.adaptlypost.com/post/api/v1', source: 'default' }),
    resolveLanguage: () => undefined,
    resolveProfile: () => state.profile,
    resolveProfileName: () => state.profile.name,
    saveProfile: (name: string, input: Record<string, unknown>) => {
      state.saved.push({ name, input });
      return { type: 'token', ...input } as StoredProfile;
    },
    deleteProfile: (name: string) => {
      state.deleted.push(name);
      return true;
    },
    deleteAllProfiles: () => {
      state.deletedAll = Object.keys(state.stored).length;
      return state.deletedAll;
    },
  };
});

const { initOutput, setInteractive } = await import('../../src/core/index.js');
const { registerAuthCommands, assertTokenShape, describeAbilities } = await import('../../src/commands/auth.js');

let stdout = '';
let stderr = '';

function run(args: string[]): Promise<unknown> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerAuthCommands(program);
  return program.parseAsync(args, { from: 'user' });
}

const account = (id: string, platform: SocialAccount['platform']): SocialAccount => ({
  id,
  platform,
  displayName: 'Acme',
  username: 'acme',
  avatarUrl: '',
  status: 'active',
});

beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });

  state.globals = {};
  state.profile = {
    name: 'default',
    token: 'adaptly_stored9999',
    tokenSource: 'credentials',
    apiUrl: 'https://post.adaptlypost.com/post/api/v1',
    defaults: {},
  };
  state.stored = {};
  state.me = { ...EDITOR_ME };
  state.accounts = [];
  state.rateLimit = undefined;
  state.confirmed = true;
  state.typed = '';
  state.opened = [];
  state.httpConfigured = [];
  state.saved = [];
  state.deleted = [];
  state.deletedAll = 0;

  initOutput({ isTTY: true, env: {}, command: 'test' });
  setInteractive(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertTokenShape', () => {
  it('accepts an AdaptlyPost token', () => {
    expect(() => assertTokenShape('adaptly_abcdef')).not.toThrow();
  });

  it('names the product a foreign token belongs to', () => {
    expect(() => assertTokenShape('redreplier_abc123')).toThrowError(/starts with redreplier_/);
    try {
      assertTokenShape('redreplier_abc123');
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(3);
      expect((error as { code: string }).code).toBe('wrong_token_prefix');
    }
  });

  it('rejects an OAuth JWT with its own message', () => {
    try {
      assertTokenShape('header.payload.signature');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('unsupported_token');
      expect((error as { exitCode: number }).exitCode).toBe(3);
    }
  });
});

describe('login', () => {
  it('refuses a foreign token before touching the network', async () => {
    state.globals = { token: 'redreplier_abc123' };
    await expect(run(['login'])).rejects.toMatchObject({ exitCode: 3 });
    expect(state.saved).toHaveLength(0);
    expect(state.httpConfigured).toHaveLength(0);
  });

  it('stores the profile and reports what the token can see', async () => {
    state.globals = { token: 'adaptly_ab12cd34ef' };
    state.accounts = [
      account('ig_1', 'INSTAGRAM'),
      account('tw_2', 'TWITTER'),
      account('tw_3', 'TWITTER'),
    ];

    await run(['login', '--name', 'personal']);

    expect(state.saved).toEqual([
      {
        name: 'default',
        input: {
          token: 'adaptly_ab12cd34ef',
          apiUrl: 'https://post.adaptlypost.com/post/api/v1',
          label: 'personal',
        },
      },
    ]);
    expect(stdout).toContain('Token valid');
    expect(stdout).toContain('3 connected');
    expect(stdout).toContain('INSTAGRAM, TWITTER');
    expect(stdout).not.toContain('adaptly_ab12cd34ef');
  });

  it('reads the token from a hidden prompt and opens the token page', async () => {
    state.typed = '  adaptly_typed12345  ';

    await run(['login']);

    expect(state.opened).toEqual(['https://adaptlypost.com/api-tokens']);
    expect(state.saved[0]?.input.token).toBe('adaptly_typed12345');
  });

  it('configures the client with the pasted token before verifying it', async () => {
    state.globals = { token: 'adaptly_ab12cd34ef' };

    await run(['login']);

    expect(state.httpConfigured).toHaveLength(1);
    expect(state.httpConfigured[0]).toMatchObject({
      profile: { name: 'default', token: 'adaptly_ab12cd34ef', tokenSource: 'flag' },
    });
  });

  it('emits the machine envelope under --json', async () => {
    initOutput({ json: true, command: 'login' });
    state.globals = { token: 'adaptly_ab12cd34ef' };
    state.accounts = [account('ig_1', 'INSTAGRAM')];

    await run(['login']);

    const payload = JSON.parse(stdout) as { ok: boolean; command: string; data: Record<string, unknown> };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('login');
    expect(payload.data).toMatchObject({ profile: 'default', accounts: 1, platforms: ['INSTAGRAM'] });
    expect(stdout).not.toContain('adaptly_ab12cd34ef');
  });
});

describe('describeAbilities', () => {
  it('lists what the key can do in order', () => {
    expect(describeAbilities({ draft: true, schedule: true, publish: true })).toBe('draft, schedule, publish');
    expect(describeAbilities({ draft: true, schedule: false, publish: false })).toBe('draft');
    expect(describeAbilities({ draft: false, schedule: false, publish: false })).toBe('read only');
  });
});

describe('whoami', () => {
  it('prints the profile, the redacted token, the workspace, the role and what the key can do', async () => {
    state.accounts = [account('ig_1', 'INSTAGRAM')];
    state.rateLimit = { limit: 600, remaining: 598, reset: 41 };

    await run(['whoami']);

    expect(stdout).toContain('profile');
    expect(stdout).toContain('adaptly_stor…');
    expect(stdout).toContain('"CI deploy", from credentials file');
    expect(stdout).toContain('https://post.adaptlypost.com/post/api/v1');
    expect(stdout).toContain('workspace  Acme (ws_1)');
    expect(stdout).toContain('role       Editor (editor, key issued by admin)');
    expect(stdout).toContain('can        draft, schedule, publish');
    expect(stdout).toContain('1 connected account, 1 platform');
    expect(stdout).toContain('598 of 600 requests left this minute');
    expect(stdout).not.toContain('expires');
    expect(stdout).not.toContain('adaptly_stored9999');
    expect(stderr).not.toContain('/me');
    expect(stderr).not.toContain('Ask a workspace admin');
  });

  it('says a contributor key cannot schedule or publish', async () => {
    state.me = {
      ...EDITOR_ME,
      tokenName: null,
      role: { key: 'contributor', name: 'Contributor' },
      issuerRole: 'contributor',
      can: { draft: true, schedule: false, publish: false },
      expiresAt: '2099-01-01T00:00:00.000Z',
    };

    await run(['whoami']);

    expect(stdout).toContain('role       Contributor (contributor)');
    expect(stdout).toContain('can        draft');
    expect(stdout).not.toContain('schedule');
    expect(stdout).toContain('expires    2099-01-01 00:00 UTC');
    expect(stderr).toContain('cannot schedule or publish');
    expect(stderr).toContain('Ask a workspace admin');
  });

  it('says a viewer key is read only', async () => {
    state.me = {
      ...EDITOR_ME,
      workspace: { id: 'ws_1', name: null },
      role: { key: 'viewer', name: 'Viewer' },
      issuerRole: 'admin',
      can: { draft: false, schedule: false, publish: false },
    };

    await run(['whoami']);

    expect(stdout).toContain('workspace  ws_1');
    expect(stdout).toContain('can        read only');
    expect(stderr).toContain('This key is read only');
  });

  it('falls back to the connected accounts when the API has no /me', async () => {
    state.me = null;
    state.accounts = [account('ig_1', 'INSTAGRAM')];

    await run(['whoami']);

    expect(stdout).toContain('adaptly_stor…');
    expect(stdout).toContain('1 connected account, 1 platform');
    expect(stdout).not.toContain('role');
    expect(stderr).not.toContain('Ask a workspace admin');
  });

  it('carries the role, the permissions and the rate limit under --json', async () => {
    initOutput({ json: true, command: 'whoami' });
    state.accounts = [account('ig_1', 'INSTAGRAM'), account('tw_1', 'TWITTER')];
    state.rateLimit = { limit: 600, remaining: 598, reset: 41 };

    await run(['whoami']);

    const payload = JSON.parse(stdout) as { data: Record<string, unknown>; meta: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      tokenType: 'api_token',
      tokenName: 'CI deploy',
      workspace: { id: 'ws_1', name: 'Acme' },
      role: { key: 'editor', name: 'Editor' },
      issuerRole: 'admin',
      permissions: ['posts.read', 'posts.draft', 'posts.schedule', 'posts.publish'],
      can: { draft: true, schedule: true, publish: true },
      expiresAt: null,
      accounts: 2,
      platforms: ['INSTAGRAM', 'TWITTER'],
    });
    expect(payload.meta).toEqual({ rateLimit: { limit: 600, remaining: 598, resetSeconds: 41 } });
  });
});

describe('logout', () => {
  beforeEach(() => {
    state.stored = {
      default: { type: 'token', token: 'adaptly_a', tokenPrefix: 'adaptly_a' },
      acme: { type: 'token', token: 'adaptly_b', tokenPrefix: 'adaptly_b' },
    };
  });

  it('removes the resolved profile once confirmed', async () => {
    state.confirmed = true;

    await run(['logout']);

    expect(state.deleted).toEqual(['default']);
    expect(stdout).toContain('Removed profile "default"');
    expect(stdout).toContain('revoke it at https://adaptlypost.com/api-tokens');
  });

  it('removes every profile with --all', async () => {
    state.globals = { yes: true };

    await run(['logout', '--all']);

    expect(state.deletedAll).toBe(2);
    expect(state.deleted).toEqual([]);
  });

  it('keeps everything when the confirmation is declined', async () => {
    state.confirmed = false;

    await run(['logout']);

    expect(state.deleted).toEqual([]);
    expect(stdout).toContain('Nothing removed.');
  });

  it('fails with exit 4 when the profile is unknown', async () => {
    state.profile = { ...state.profile, name: 'ghost' };
    await expect(run(['logout'])).rejects.toMatchObject({ exitCode: 4, code: 'unknown_profile' });
    expect(state.deleted).toEqual([]);
  });

  it('fails with exit 4 when nothing is stored', async () => {
    state.stored = {};
    await expect(run(['logout'])).rejects.toMatchObject({ exitCode: 4, code: 'no_profiles' });
  });
});
