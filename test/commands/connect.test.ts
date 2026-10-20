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

    expect(client.createConnectLink).toHaveBeenCalledWith({});
    expect(stdoutJson()).toEqual({ ok: true, command: 'connect.create', data: link });
  });

  it('sends every option it was given', async () => {
    vi.mocked(client.createConnectLink).mockResolvedValue({
      url: 'https://adaptlypost.com/connect/tok_2',
      token: 'tok_2',
      expiresAt: '2026-11-30T17:00:00.000Z',
    });

    await run([
      'connect', 'create',
      '--name', 'Acme onboarding',
      '--private',
      '--platform', 'instagram',
      '--platform', 'TIKTOK',
      '--max-accounts', '3',
      '--expires', '2026-11-30 18:00',
      '--timezone', 'Europe/Warsaw',
    ]);

    expect(client.createConnectLink).toHaveBeenCalledWith({
      name: 'Acme onboarding',
      visibility: 'PRIVATE',
      allowedPlatforms: ['INSTAGRAM', 'TIKTOK'],
      maxAccounts: 3,
      expiresAt: '2026-11-30T17:00:00.000Z',
    });
  });

  it('asks for a link that never expires and prints its null expiry', async () => {
    const link = { url: 'https://adaptlypost.com/connect/tok_3', token: 'tok_3', expiresAt: null };
    vi.mocked(client.createConnectLink).mockResolvedValue(link);

    await run(['connect', 'create', '--never-expires']);

    expect(client.createConnectLink).toHaveBeenCalledWith({ neverExpires: true });
    expect(stdoutJson()).toMatchObject({ data: { expiresAt: null } });
  });

  it.each([
    [['--expires', '+30d', '--never-expires'], 'either --expires or --never-expires'],
    [['--max-accounts', '0'], '--max-accounts'],
    [['--max-accounts', '2.5'], '--max-accounts'],
    [['--expires', 'someday'], '--expires'],
    [['--platform', 'myspace'], 'Unknown platform'],
  ])('refuses %j with exit 2 before calling the API', async (flags, message) => {
    await expect(run(['connect', 'create', ...flags])).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining(message),
    });
    expect(client.createConnectLink).not.toHaveBeenCalled();
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
