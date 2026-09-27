import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Webhook } from '../../src/api/types.js';

vi.mock('../../src/api/client.js', () => ({
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  getWebhook: vi.fn(),
  listWebhooks: vi.fn(),
  testWebhook: vi.fn(),
  updateWebhook: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { buildWebhookUpdate, registerWebhookCommands, webhookState } = await import('../../src/commands/webhook.js');
const { initOutput } = await import('../../src/core/output.js');
const { setInteractive } = await import('../../src/core/prompt.js');

const webhook: Webhook = {
  id: 'wh_1',
  url: 'https://example.com/hooks',
  active: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  lastSuccessAt: null,
  lastFailureAt: null,
  disabledAt: null,
};

let written: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-y, --yes');
  registerWebhookCommands(program);
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

describe('the webhook command tree', () => {
  it('registers every verb with its aliases', () => {
    const noun = build().commands.find((command) => command.name() === 'webhook');
    expect(noun?.aliases()).toContain('webhooks');
    expect(noun?.commands.map((command) => command.name())).toEqual([
      'create',
      'list',
      'view',
      'update',
      'delete',
      'test',
    ]);
    const aliasOf = (name: string): string[] =>
      noun?.commands.find((command) => command.name() === name)?.aliases() ?? [];
    expect(aliasOf('list')).toContain('ls');
    expect(aliasOf('view')).toContain('get');
    expect(aliasOf('delete')).toContain('rm');
  });
});

describe('webhook create', () => {
  it('sends the url and returns the secret in the machine document', async () => {
    vi.mocked(client.createWebhook).mockResolvedValue({ ...webhook, secret: 'whsec_1' });

    await run(['webhook', 'create', '--url', 'https://example.com/hooks']);

    expect(client.createWebhook).toHaveBeenCalledWith({ url: 'https://example.com/hooks' });
    expect(stdoutJson()).toMatchObject({ ok: true, command: 'webhook.create', data: { secret: 'whsec_1' } });
  });

  it('refuses a missing or malformed url before sending', async () => {
    await expect(run(['webhook', 'create'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['webhook', 'create', '--url', 'example.com/hooks'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['webhook', 'create', '--url', 'ftp://example.com'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.createWebhook).not.toHaveBeenCalled();
  });
});

describe('webhook list and view', () => {
  it('prints the list as an array', async () => {
    vi.mocked(client.listWebhooks).mockResolvedValue({ webhooks: [webhook] });

    await run(['webhook', 'ls']);

    expect(stdoutJson()).toMatchObject({ command: 'webhook.list', data: [webhook], meta: { total: 1, hasMore: false } });
  });

  it('reads one webhook', async () => {
    vi.mocked(client.getWebhook).mockResolvedValue(webhook);

    await run(['webhook', 'get', 'wh_1']);

    expect(client.getWebhook).toHaveBeenCalledWith('wh_1');
    expect(stdoutJson()).toMatchObject({ command: 'webhook.view', data: { id: 'wh_1' } });
  });

  it('labels a disabled webhook as disabled whatever its active flag says', () => {
    expect(webhookState(webhook)).toBe('active');
    expect(webhookState({ ...webhook, active: false })).toBe('inactive');
    expect(webhookState({ ...webhook, disabledAt: '2026-09-02T00:00:00.000Z' })).toBe('disabled');
  });
});

describe('webhook update', () => {
  it('builds the body from the flags', () => {
    expect(buildWebhookUpdate({ inactive: true })).toEqual({ active: false });
    expect(buildWebhookUpdate({ url: 'https://new.example.com', active: true })).toEqual({
      url: 'https://new.example.com',
      active: true,
    });
  });

  it('refuses both --active and --inactive, and an empty update', () => {
    expect(() => buildWebhookUpdate({ active: true, inactive: true })).toThrow(/not both/);
    expect(() => buildWebhookUpdate({})).toThrow(/Nothing to update/);
  });

  it('sends the patch', async () => {
    vi.mocked(client.updateWebhook).mockResolvedValue({ ...webhook, active: false });

    await run(['webhook', 'update', 'wh_1', '--inactive']);

    expect(client.updateWebhook).toHaveBeenCalledWith('wh_1', { active: false });
    expect(stdoutJson()).toMatchObject({ command: 'webhook.update', data: { active: false } });
  });
});

describe('webhook delete', () => {
  it('deletes without a prompt under --yes', async () => {
    vi.mocked(client.deleteWebhook).mockResolvedValue({ deleted: true });

    await run(['webhook', 'rm', 'wh_1', '--yes']);

    expect(client.getWebhook).not.toHaveBeenCalled();
    expect(client.deleteWebhook).toHaveBeenCalledWith('wh_1');
    expect(stdoutJson()).toMatchObject({ command: 'webhook.delete', data: { deleted: true } });
  });

  it('asks first, and fails with exit 2 when it cannot ask', async () => {
    vi.mocked(client.getWebhook).mockResolvedValue(webhook);

    await expect(run(['webhook', 'delete', 'wh_1'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.deleteWebhook).not.toHaveBeenCalled();
  });
});

describe('webhook test', () => {
  it('prints the delivery result', async () => {
    vi.mocked(client.testWebhook).mockResolvedValue({ success: true, statusCode: 200 });

    await run(['webhook', 'test', 'wh_1']);

    expect(stdoutJson()).toMatchObject({ command: 'webhook.test', data: { success: true, statusCode: 200 } });
  });

  it('exits 1 when the endpoint rejected the test', async () => {
    vi.mocked(client.testWebhook).mockResolvedValue({ success: false, statusCode: 500, error: 'HTTP 500' });

    await expect(run(['webhook', 'test', 'wh_1'])).rejects.toMatchObject({ exitCode: 1, message: 'HTTP 500' });
  });
});
