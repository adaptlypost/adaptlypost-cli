import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceMember } from '../../src/api/types.js';

vi.mock('../../src/api/client.js', () => ({
  listMembers: vi.fn(),
  removeMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { memberName, registerMemberCommands } = await import('../../src/commands/member.js');
const { initOutput } = await import('../../src/core/output.js');
const { setInteractive } = await import('../../src/core/prompt.js');

const member: WorkspaceMember = {
  userId: 'user_1',
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: null,
  role: 'editor',
  organizationRoles: ['org-member'],
  joinedAt: '2026-11-01T09:00:00.000Z',
};

let written: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-y, --yes');
  registerMemberCommands(program);
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

describe('the member command tree', () => {
  it('registers every verb with its aliases', () => {
    const noun = build().commands.find((command) => command.name() === 'member');
    expect(noun?.aliases()).toContain('members');
    expect(noun?.commands.map((command) => command.name())).toEqual(['list', 'remove']);
    expect(noun?.commands.find((command) => command.name() === 'remove')?.aliases()).toContain('rm');
  });
});

describe('memberName', () => {
  it('joins the parts it has', () => {
    expect(memberName(member)).toBe('Ana');
    expect(memberName({ ...member, firstName: null })).toBe('');
  });
});

describe('member list', () => {
  it('prints the members unmodified', async () => {
    vi.mocked(client.listMembers).mockResolvedValue({ members: [member] });

    await run(['member', 'list']);

    expect(stdoutJson()).toMatchObject({ ok: true, command: 'member.list', data: [member] });
  });
});

describe('member remove', () => {
  it('removes from this workspace under --yes', async () => {
    vi.mocked(client.removeMember).mockResolvedValue({ success: true });

    await run(['member', 'remove', 'user_1', '--yes']);

    expect(client.removeMember).toHaveBeenCalledWith('user_1');
    expect(client.removeOrganizationMember).not.toHaveBeenCalled();
    expect(stdoutJson()).toMatchObject({ command: 'member.remove', data: { success: true } });
  });

  it('removes from the organization with --organization', async () => {
    vi.mocked(client.removeOrganizationMember).mockResolvedValue({ success: true });

    await run(['member', 'remove', 'user_1', '--organization', '--yes']);

    expect(client.removeOrganizationMember).toHaveBeenCalledWith('user_1');
    expect(client.removeMember).not.toHaveBeenCalled();
    expect(stdoutJson()).toMatchObject({ command: 'member.remove-organization', data: { success: true } });
  });

  it('asks first, and fails with exit 2 when it cannot ask', async () => {
    vi.mocked(client.listMembers).mockResolvedValue({ members: [member] });

    await expect(run(['member', 'remove', 'user_1'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.removeMember).not.toHaveBeenCalled();
  });
});
