import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSocialAccount, listPinterestBoards, listSocialAccounts, searchInstagramAudio } = vi.hoisted(() => ({
  checkSocialAccount: vi.fn(),
  listPinterestBoards: vi.fn(),
  listSocialAccounts: vi.fn(),
  searchInstagramAudio: vi.fn(),
}));

vi.mock('../../src/api/client.js', () => ({
  checkSocialAccount,
  listPinterestBoards,
  listSocialAccounts,
  searchInstagramAudio,
}));

import {
  accountHandle,
  accountNote,
  audioArtist,
  formatAudioLength,
  normalizeAudioType,
  filterAccounts,
  findAccount,
  needsReauthorisation,
  registerAccountCommands,
} from '../../src/commands/account.js';
import type { SocialAccount } from '../../src/api/types.js';
import { setOutputMode } from '../../src/core/index.js';

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: 'acc_1',
    platform: 'LINKEDIN',
    displayName: 'Ada Lovelace',
    username: 'ada',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  }) as SocialAccount;

const page = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  account({ id: 'acc_fb', platform: 'FACEBOOK', pageId: 'fb_page_91c', username: undefined, ...overrides });

const buildProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  registerAccountCommands(program);
  return program;
};

const accountsCommand = (program: Command): Command =>
  program.commands.find((command) => command.name() === 'accounts') as Command;

const run = (args: string[]): Promise<unknown> =>
  buildProgram().parseAsync(['node', 'adaptlypost', 'accounts', ...args]);

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  checkSocialAccount.mockReset();
  listPinterestBoards.mockReset();
  listSocialAccounts.mockReset();
  searchInstagramAudio.mockReset();
  setOutputMode('machine');
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

describe('registerAccountCommands', () => {
  it('registers list, view, check, instagram-audio and pinterest-boards', () => {
    expect(accountsCommand(buildProgram()).commands.map((command) => command.name())).toEqual([
      'list',
      'view',
      'check',
      'instagram-audio',
      'pinterest-boards',
    ]);
  });
});

describe('accounts instagram-audio', () => {
  const instagram = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
    account({ id: 'ig_1', platform: 'INSTAGRAM', supportsInstagramAudio: true, ...overrides });

  it('searches music by default and prints the API payload', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [instagram()] });
    searchInstagramAudio.mockResolvedValue({
      audio: [{ audioId: '901', audioType: 'music', title: 'Sunrise', displayArtist: 'Ada', durationMs: 95_000 }],
    });

    await run(['instagram-audio', 'ig_1', '--search', ' sunrise ']);

    expect(searchInstagramAudio).toHaveBeenCalledWith('ig_1', { audioType: 'music', searchQuery: 'sunrise' });
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'accounts.instagram-audio',
      data: [{ audioId: '901', title: 'Sunrise' }],
      meta: { total: 1 },
    });
  });

  it('asks for trending original sounds when there is no search', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [instagram()] });
    searchInstagramAudio.mockResolvedValue({ audio: [] });

    await run(['instagram-audio', 'ig_1', '--type', 'original-sound']);

    expect(searchInstagramAudio).toHaveBeenCalledWith('ig_1', { audioType: 'original_sound', searchQuery: undefined });
  });

  it('refuses other platforms, accounts without audio support and long searches before calling the API', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [account(), instagram({ id: 'ig_2', supportsInstagramAudio: false })] });

    await expect(run(['instagram-audio', 'acc_1'])).rejects.toThrow(/no Instagram audio/);
    await expect(run(['instagram-audio', 'ig_2'])).rejects.toThrow(/cannot add audio/);
    await expect(run(['instagram-audio', 'ig_2', '--search', 'x'.repeat(101)])).rejects.toThrow(/limit is 100/);
    await expect(run(['instagram-audio', 'ig_2', '--type', 'podcast'])).rejects.toThrow(/Unknown audio type/);
    expect(searchInstagramAudio).not.toHaveBeenCalled();
  });

  it('formats the audio type, artist and length', () => {
    expect(normalizeAudioType('Original Sound')).toBe('original_sound');
    expect(audioArtist({ audioId: '1', audioType: 'original_sound', igUsername: 'ada' })).toBe('@ada');
    expect(audioArtist({ audioId: '1', audioType: 'music', displayArtist: 'Ada' })).toBe('Ada');
    expect(formatAudioLength(65_400)).toBe('1:05');
    expect(formatAudioLength(undefined)).toBe('—');
  });
});

describe('accounts pinterest-boards', () => {
  const pinterest = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
    account({ id: 'pin_1', platform: 'PINTEREST', ...overrides });

  const boards = [
    { id: '549755885175', name: 'Recipes', description: 'Weeknight dinners', privacy: 'PUBLIC', pinCount: 42 },
    { id: '549755885176', name: 'Drafts', privacy: 'SECRET' },
  ];

  it('lists the boards of the account and prints the API payload', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [pinterest()] });
    listPinterestBoards.mockResolvedValue({ boards });

    await run(['pinterest-boards', 'pin_1']);

    expect(listPinterestBoards).toHaveBeenCalledWith('pin_1');
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'accounts.pinterest-boards',
      data: boards,
      meta: { total: 2, hasMore: false },
    });
  });

  it('prints a table with the full board id, privacy and pin count', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [pinterest()] });
    listPinterestBoards.mockResolvedValue({ boards });
    setOutputMode('human');

    await run(['pinterest-boards', 'pin_1']);

    const lines = stdout.join('').split('\n');
    expect(lines[0]).toMatch(/^BOARD ID\s+NAME\s+PRIVACY\s+PINS$/);
    expect(lines[1]).toMatch(/^549755885175\s+Recipes\s+public\s+42$/);
    expect(lines[2]).toMatch(/^549755885176\s+Drafts\s+secret\s+—$/);
    expect(stdout.join('')).toContain('2 boards');
    expect(stderr.join('')).toContain('--pinterest-board <boardId>');
    expect(stderr.join('')).toContain('--pinterest-board-name');
  });

  it('says what a post does when the account has no boards', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [pinterest()] });
    listPinterestBoards.mockResolvedValue({ boards: [] });
    setOutputMode('human');

    await run(['pinterest-boards', 'pin_1']);

    expect(stdout.join('')).toContain('This Pinterest account has no boards.');
    expect(stderr.join('')).toContain('board named AdaptlyPost');
  });

  it('refuses other platforms and unknown ids before calling the API', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [account(), pinterest()] });

    await expect(run(['pinterest-boards', 'acc_1'])).rejects.toThrow(/no Pinterest boards/);
    await expect(run(['pinterest-boards', 'pin_missing'])).rejects.toThrow(/No account with id/);
    expect(listPinterestBoards).not.toHaveBeenCalled();
  });
});

describe('accounts check', () => {
  it('re-checks a Facebook page by its page id', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [page()] });
    checkSocialAccount.mockResolvedValue({
      id: 'acc_fb',
      platform: 'FACEBOOK',
      displayName: 'Ada Lovelace',
      pageId: 'fb_page_91c',
      status: 'active',
      checkedAt: '2026-09-18T10:00:00.000Z',
    });

    await run(['check', 'fb_page_91c']);

    expect(checkSocialAccount).toHaveBeenCalledWith('acc_fb');
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'accounts.check',
      data: { id: 'acc_fb', status: 'active', checkedAt: '2026-09-18T10:00:00.000Z' },
    });
  });

  it('refuses platforms that have no token check', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [account()] });

    await expect(run(['check', 'acc_1'])).rejects.toThrow(/cannot be re-checked/);
    expect(checkSocialAccount).not.toHaveBeenCalled();
  });

  it('fails before calling the API when the id is unknown', async () => {
    listSocialAccounts.mockResolvedValue({ accounts: [page()] });

    await expect(run(['check', 'acc_missing'])).rejects.toThrow(/No account with id/);
    expect(checkSocialAccount).not.toHaveBeenCalled();
  });
});

describe('account helpers', () => {
  it('treats only unauthorized accounts as needing a reconnect', () => {
    expect(needsReauthorisation(account({ status: 'unauthorized' }))).toBe(true);
    expect(needsReauthorisation(account())).toBe(false);
  });

  it('prefixes a bare username with @ and leaves an existing one alone', () => {
    expect(accountHandle(account({ username: 'ada' }))).toBe('@ada');
    expect(accountHandle(account({ username: '@ada' }))).toBe('@ada');
    expect(accountHandle(page())).toBe('—');
  });

  it('shows the platform reason ahead of the page id', () => {
    expect(accountNote(page({ status: 'unauthorized', unauthorizedReason: 'Token expired' }))).toBe(
      'Token expired',
    );
    expect(accountNote(page())).toContain('page');
  });

  it('filters by platform and status together', () => {
    const accounts = [account(), page(), page({ id: 'acc_fb2', status: 'unauthorized' })];

    expect(filterAccounts(accounts, { platform: ['FACEBOOK'] })).toHaveLength(2);
    expect(filterAccounts(accounts, { platform: ['FACEBOOK'], status: 'unauthorized' })).toHaveLength(1);
  });

  it('finds an account by its id or its page id', () => {
    const accounts = [account(), page()];

    expect(findAccount(accounts, 'acc_fb')?.id).toBe('acc_fb');
    expect(findAccount(accounts, 'fb_page_91c')?.id).toBe('acc_fb');
    expect(findAccount(accounts, 'nope')).toBeUndefined();
  });
});
