import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', () => ({
  createConnectLink: vi.fn(),
  revokeConnectLink: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { registerConnectCommands } = await import('../../src/commands/connect.js');
const { initOutput } = await import('../../src/core/output.js');
const { setInteractive } = await import('../../src/core/prompt.js');

let written: string[] = [];

const run = (argv: string[]): Promise<unknown> => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-y, --yes');
  registerConnectCommands(program);
  return program.parseAsync(argv, { from: 'user' });
};

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

describe('connect create', () => {
  it('creates a link and prints it unmodified', async () => {
    const link = { url: 'https://adaptlypost.com/connect/tok_1', token: 'tok_1', expiresAt: '2026-10-01T00:00:00.000Z' };
    vi.mocked(client.createConnectLink).mockResolvedValue(link);

    await run(['connect', 'create']);

    expect(client.createConnectLink).toHaveBeenCalledWith();
    expect(stdoutJson()).toEqual({ ok: true, command: 'connect.create', data: link });
  });
});

describe('connect revoke', () => {
  it('revokes without a prompt under --yes', async () => {
    vi.mocked(client.revokeConnectLink).mockResolvedValue({ success: true });

    await run(['connect', 'revoke', 'tok_1', '--yes']);

    expect(client.revokeConnectLink).toHaveBeenCalledWith('tok_1');
    expect(stdoutJson()).toMatchObject({ command: 'connect.revoke', data: { success: true } });
  });

  it('asks first, and fails with exit 2 when it cannot ask', async () => {
    await expect(run(['connect', 'revoke', 'tok_1'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.revokeConnectLink).not.toHaveBeenCalled();
  });
});
