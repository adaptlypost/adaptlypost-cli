import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSocialAccount, listSocialAccounts } = vi.hoisted(() => ({
  checkSocialAccount: vi.fn(),
  listSocialAccounts: vi.fn(),
}));

vi.mock('../../src/api/client.js', () => ({ checkSocialAccount, listSocialAccounts }));

import {
  accountHandle,
  accountNote,
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

beforeEach(() => {
  checkSocialAccount.mockReset();
  listSocialAccounts.mockReset();
  setOutputMode('machine');
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

describe('registerAccountCommands', () => {
  it('registers list, view and check', () => {
    expect(accountsCommand(buildProgram()).commands.map((command) => command.name())).toEqual([
      'list',
      'view',
      'check',
    ]);
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
