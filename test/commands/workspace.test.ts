import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreatedWorkspace, WorkspaceSummary } from '../../src/api/types.js';

vi.mock('../../src/api/client.js', () => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { buildWorkspaceCreate, registerWorkspaceCommands } = await import('../../src/commands/workspace.js');
const { initOutput } = await import('../../src/core/output.js');
const { setInteractive } = await import('../../src/core/prompt.js');

const created: CreatedWorkspace = {
  id: 'ws_2',
  name: 'Client B',
  description: null,
  organizationId: 'org_1',
  isDefault: false,
  connectionLimit: 5,
  createdAt: '2026-11-18T09:00:00.000Z',
};

const summary = {
  id: 'ws_2',
  name: 'Client B',
  organization: { id: 'org_1', name: 'Acme' },
  role: { key: 'admin', name: 'Admin' },
  permissions: [],
  isDefault: false,
  current: false,
} as unknown as WorkspaceSummary;

let written: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-y, --yes');
  registerWorkspaceCommands(program);
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

describe('the workspace command tree', () => {
  it('registers every verb with its aliases', () => {
    const noun = build().commands.find((command) => command.name() === 'workspace');
    expect(noun?.aliases()).toContain('workspaces');
    expect(noun?.commands.map((command) => command.name())).toEqual(['list', 'create', 'delete']);
  });
});

describe('buildWorkspaceCreate', () => {
  it('sends only the fields it was given', () => {
    expect(buildWorkspaceCreate({ name: '  Client B ' })).toEqual({ name: 'Client B' });
    expect(buildWorkspaceCreate({ name: 'Client B', description: 'Retainer', connectionLimit: '0' })).toEqual({
      name: 'Client B',
      description: 'Retainer',
      connectionLimit: 0,
    });
  });

  it.each([
    [{}, '--name is required'],
    [{ name: '   ' }, '--name cannot be empty'],
    [{ name: 'a'.repeat(101) }, 'at most 100'],
    [{ name: '<b>' }, 'cannot contain < or >'],
    [{ name: 'B', description: 'd'.repeat(501) }, 'at most 500'],
    [{ name: 'B', connectionLimit: '10001' }, '--connection-limit'],
    [{ name: 'B', connectionLimit: '1.5' }, '--connection-limit'],
  ])('refuses %j', (options, message) => {
    expect(() => buildWorkspaceCreate(options)).toThrow(expect.objectContaining({ exitCode: 2 }));
    expect(() => buildWorkspaceCreate(options)).toThrow(message);
  });
});

describe('workspace list', () => {
  it('prints the workspaces the token reaches', async () => {
    vi.mocked(client.listWorkspaces).mockResolvedValue({ workspaces: [summary] });

    await run(['workspace', 'list']);

    expect(stdoutJson()).toMatchObject({ ok: true, command: 'workspace.list', data: [{ id: 'ws_2' }] });
  });
});

describe('workspace create', () => {
  it('creates a workspace and prints it', async () => {
    vi.mocked(client.createWorkspace).mockResolvedValue(created);

    await run(['workspace', 'create', '--name', 'Client B', '--connection-limit', '5']);

    expect(client.createWorkspace).toHaveBeenCalledWith({ name: 'Client B', connectionLimit: 5 });
    expect(stdoutJson()).toEqual({ ok: true, command: 'workspace.create', data: created });
  });
});

describe('workspace delete', () => {
  it('deletes without a prompt under --yes', async () => {
    vi.mocked(client.deleteWorkspace).mockResolvedValue({ success: true });

    await run(['workspace', 'delete', 'ws_2', '--yes']);

    expect(client.listWorkspaces).not.toHaveBeenCalled();
    expect(client.deleteWorkspace).toHaveBeenCalledWith('ws_2');
    expect(stdoutJson()).toMatchObject({ command: 'workspace.delete', data: { success: true } });
  });

  it('asks first, and fails with exit 2 when it cannot ask', async () => {
    vi.mocked(client.listWorkspaces).mockResolvedValue({ workspaces: [summary] });

    await expect(run(['workspace', 'delete', 'ws_2'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });
});
