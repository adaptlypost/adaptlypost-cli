import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Invitation, Me } from '../../src/api/types.js';

vi.mock('../../src/api/client.js', () => ({
  getMe: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
  sendInvitation: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { buildInvitation, parseInviteWorkspaces, registerInviteCommands } = await import(
  '../../src/commands/invite.js'
);
const { initOutput } = await import('../../src/core/output.js');
const { setInteractive } = await import('../../src/core/prompt.js');

const invitation: Invitation = {
  id: 'inv_1',
  email: 'ana@example.com',
  organizationId: 'org_1',
  organizationRole: 'org-member',
  status: 'pending',
  workspaces: [{ workspaceId: 'ws_1', workspaceName: 'Main', role: 'editor' }],
  expiresAt: '2026-11-25T09:00:00.000Z',
  createdAt: '2026-11-18T09:00:00.000Z',
};

let written: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-y, --yes');
  registerInviteCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> => build().parseAsync(argv, { from: 'user' });

const stdoutJson = (): Record<string, unknown> => JSON.parse(written.join('')) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  written = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  initOutput({ json: true });
  setInteractive(false);
});

describe('the invite command tree', () => {
  it('registers every verb with its aliases', () => {
    const noun = build().commands.find((command) => command.name() === 'invite');
    expect(noun?.aliases()).toEqual(['invites', 'invitation', 'invitations']);
    expect(noun?.commands.map((command) => command.name())).toEqual(['send', 'list', 'revoke']);
  });
});

describe('parseInviteWorkspaces', () => {
  it('takes the role after a colon, or --role', () => {
    expect(parseInviteWorkspaces(['ws_1:Viewer', 'ws_2'], 'editor')).toEqual([
      { workspaceId: 'ws_1', role: 'viewer' },
      { workspaceId: 'ws_2', role: 'editor' },
    ]);
  });

  it.each([
    [['ws_1'], undefined, 'No role for workspace ws_1'],
    [['ws_1:owner'], undefined, 'Unknown role "owner"'],
    [['ws_1:editor', 'ws_1:viewer'], undefined, 'listed twice'],
    [[':editor'], undefined, 'is not a workspace'],
  ])('refuses %j', (values, role, message) => {
    expect(() => parseInviteWorkspaces(values, role)).toThrow(message);
  });
});

describe('buildInvitation', () => {
  it('invites to the current workspace when no --workspace is given', () => {
    expect(buildInvitation('ana@example.com', { workspace: [], role: 'editor' }, 'ws_1')).toEqual({
      email: 'ana@example.com',
      workspaces: [{ workspaceId: 'ws_1', role: 'editor' }],
    });
  });

  it('adds the organization role and the credit allowance', () => {
    expect(
      buildInvitation('ana@example.com', { workspace: ['ws_1:admin'], orgAdmin: true, monthlyCredits: '100' }),
    ).toEqual({
      email: 'ana@example.com',
      workspaces: [{ workspaceId: 'ws_1', role: 'admin' }],
      organizationRole: 'org-admin',
      creditAllowance: { mode: 'MONTHLY', monthlyAmount: 100 },
    });
    expect(buildInvitation('ana@example.com', { workspace: ['ws_1:viewer'], fixedCredits: '0' })).toMatchObject({
      creditAllowance: { mode: 'FIXED', balance: 0 },
    });
  });

  it.each([
    ['not-an-email', { workspace: [], role: 'editor' }, 'is not an email address'],
    ['ana@example.com', { workspace: [] }, '--role is required'],
    ['ana@example.com', { workspace: ['ws_1:editor'], monthlyCredits: '5', fixedCredits: '5' }, 'not both'],
    ['ana@example.com', { workspace: ['ws_1:editor'], monthlyCredits: '0' }, '--monthly-credits'],
    ['ana@example.com', { workspace: ['ws_1:editor'], fixedCredits: '100001' }, '--fixed-credits'],
  ])('refuses %s with %j', (email, options, message) => {
    expect(() => buildInvitation(email, options, 'ws_1')).toThrow(message);
  });
});

describe('invite send', () => {
  it('looks up the current workspace when only --role is given', async () => {
    vi.mocked(client.getMe).mockResolvedValue({ workspace: { id: 'ws_1' } } as Me);
    vi.mocked(client.sendInvitation).mockResolvedValue(invitation);

    await run(['invite', 'send', 'ana@example.com', '--role', 'editor']);

    expect(client.sendInvitation).toHaveBeenCalledWith({
      email: 'ana@example.com',
      workspaces: [{ workspaceId: 'ws_1', role: 'editor' }],
    });
    expect(stdoutJson()).toEqual({ ok: true, command: 'invite.send', data: invitation });
  });

  it('sends repeated --workspace flags without asking who the token is', async () => {
    vi.mocked(client.sendInvitation).mockResolvedValue(invitation);

    await run(['invite', 'send', 'ana@example.com', '--workspace', 'ws_1:editor', '--workspace', 'ws_2:viewer']);

    expect(client.getMe).not.toHaveBeenCalled();
    expect(client.sendInvitation).toHaveBeenCalledWith({
      email: 'ana@example.com',
      workspaces: [
        { workspaceId: 'ws_1', role: 'editor' },
        { workspaceId: 'ws_2', role: 'viewer' },
      ],
    });
  });
});

describe('invite list', () => {
  it('sends the page and prints the paging metadata', async () => {
    vi.mocked(client.listInvitations).mockResolvedValue({ invitations: [invitation], total: 3, hasMore: true });

    await run(['invite', 'list', '--limit', '1', '--offset', '1']);

    expect(client.listInvitations).toHaveBeenCalledWith({ limit: 1, offset: 1 });
    expect(stdoutJson()).toMatchObject({
      command: 'invite.list',
      data: [invitation],
      meta: { total: 3, limit: 1, offset: 1, hasMore: true },
    });
  });

  it('pages through everything with --all', async () => {
    vi.mocked(client.listInvitations)
      .mockResolvedValueOnce({ invitations: [invitation], total: 2, hasMore: true })
      .mockResolvedValueOnce({ invitations: [{ ...invitation, id: 'inv_2' }], total: 2, hasMore: false });

    await run(['invite', 'list', '--all']);

    expect(client.listInvitations).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(client.listInvitations).toHaveBeenNthCalledWith(2, { limit: 100, offset: 1 });
    expect((stdoutJson().data as Invitation[]).map((item) => item.id)).toEqual(['inv_1', 'inv_2']);
  });
});

describe('invite revoke', () => {
  it('revokes without a prompt under --yes', async () => {
    vi.mocked(client.revokeInvitation).mockResolvedValue({ ...invitation, status: 'revoked' });

    await run(['invite', 'revoke', 'inv_1', '--yes']);

    expect(client.revokeInvitation).toHaveBeenCalledWith('inv_1');
    expect(stdoutJson()).toMatchObject({ command: 'invite.revoke', data: { status: 'revoked' } });
  });

  it('asks first, and fails with exit 2 when it cannot ask', async () => {
    await expect(run(['invite', 'revoke', 'inv_1'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.revokeInvitation).not.toHaveBeenCalled();
  });
});
