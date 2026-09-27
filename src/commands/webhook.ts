import type { Command } from 'commander';

import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook,
} from '../api/client.js';
import { WEBHOOK_EVENTS, type UpdateWebhookRequest, type Webhook } from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  failure,
  formatId,
  formatRelative,
  hint,
  isMachine,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  promptConfirm,
  success,
  usageError,
  warn,
  type Column,
} from '../core/index.js';

interface GlobalOptions {
  yes?: boolean;
}

interface CreateOptions {
  url?: string;
}

interface UpdateOptions {
  url?: string;
  active?: boolean;
  inactive?: boolean;
}

export const assertWebhookUrl = (value: string): string => {
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw usageError(`"${value}" is not a URL.`, 'Pass a full URL such as https://example.com/hooks/adaptlypost');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw usageError(`"${value}" must be an http or https URL.`);
  }
  return url;
};

export const webhookState = (webhook: Webhook): string => {
  if (webhook.disabledAt) return 'disabled';
  return webhook.active ? 'active' : 'inactive';
};

const when = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatRelative(date);
};

const detailsOf = (webhook: Webhook): [string, string][] => [
  ['id', webhook.id],
  ['url', webhook.url],
  ['status', webhookState(webhook)],
  ['last success', when(webhook.lastSuccessAt)],
  ['last failure', when(webhook.lastFailureAt)],
  ...(webhook.disabledAt ? [['disabled', when(webhook.disabledAt)] as [string, string]] : []),
];

const LIST_COLUMNS: Column<Webhook>[] = [
  { header: 'ID', value: (webhook) => formatId(webhook.id) },
  { header: 'STATUS', value: webhookState },
  { header: 'LAST SUCCESS', value: (webhook) => when(webhook.lastSuccessAt) },
  { header: 'LAST FAILURE', value: (webhook) => when(webhook.lastFailureAt) },
  { header: 'URL', value: (webhook) => webhook.url },
];

async function runCreate(options: CreateOptions): Promise<void> {
  if (options.url === undefined) {
    throw usageError('--url is required.', 'webhook create --url https://example.com/hooks/adaptlypost');
  }

  const created = await createWebhook({ url: assertWebhookUrl(options.url) });

  if (isMachine()) {
    printResult('webhook.create', created);
    return;
  }

  success(`Webhook created  ${formatId(created.id)}`);
  printKeyValues([...detailsOf(created), ['secret', created.secret]]);
  warn('The signing secret is shown only now. Store it where your receiver can read it.');
  hint(`Events: ${WEBHOOK_EVENTS.join(', ')}. Send a test with: ${PRODUCT.binName} webhook test ${created.id}`);
}

async function runList(): Promise<void> {
  const { webhooks } = await listWebhooks();

  if (isMachine()) {
    printResult('webhook.list', webhooks, { total: webhooks.length, hasMore: false });
    printFieldHints(webhooks);
    return;
  }

  if (webhooks.length === 0) {
    print('No webhooks in this workspace.');
    hint(`Add one with: ${PRODUCT.binName} webhook create --url <url>`);
    return;
  }

  printTable(webhooks, LIST_COLUMNS);
  print();
  print(`${webhooks.length} ${webhooks.length === 1 ? 'webhook' : 'webhooks'}`);
}

async function runView(id: string): Promise<void> {
  const webhook = await getWebhook(id);

  if (isMachine()) {
    printResult('webhook.view', webhook);
    return;
  }

  printKeyValues(detailsOf(webhook), '');
}

export function buildWebhookUpdate(options: UpdateOptions): UpdateWebhookRequest {
  if (options.active && options.inactive) {
    throw usageError('Pass --active or --inactive, not both.');
  }

  const body: UpdateWebhookRequest = {};
  if (options.url !== undefined) body.url = assertWebhookUrl(options.url);
  if (options.active) body.active = true;
  if (options.inactive) body.active = false;

  if (Object.keys(body).length === 0) {
    throw usageError('Nothing to update.', 'Pass --url, --active or --inactive. Events are not editable');
  }
  return body;
}

async function runUpdate(id: string, options: UpdateOptions): Promise<void> {
  const updated = await updateWebhook(id, buildWebhookUpdate(options));

  if (isMachine()) {
    printResult('webhook.update', updated);
    return;
  }

  success(`Webhook updated  ${formatId(updated.id)}`);
  printKeyValues(detailsOf(updated));
}

async function runDelete(id: string, options: GlobalOptions): Promise<void> {
  if (!options.yes) {
    const webhook = await getWebhook(id);
    const proceed = await promptConfirm(
      `Delete webhook ${formatId(webhook.id)} (${webhook.url})? Deliveries to it stop at once.`,
      { assumeYes: false },
    );
    if (!proceed) {
      throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
    }
  }

  const deleted = await deleteWebhook(id);

  if (isMachine()) {
    printResult('webhook.delete', deleted);
    return;
  }

  success('Deleted');
}

async function runTest(id: string): Promise<void> {
  const result = await testWebhook(id);

  if (isMachine()) {
    printResult('webhook.test', result);
  } else if (result.success) {
    success(`Test delivery accepted${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}`);
  } else {
    failure(`Test delivery failed${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}`);
  }

  if (!result.success) {
    throw new CliError(result.error ?? `The endpoint answered ${result.statusCode ?? 'with an error'}.`, {
      exitCode: ExitCode.GENERIC,
      hint: 'The receiver must answer 2xx within a few seconds. Check its logs, then run the test again',
    });
  }
}

export function registerWebhookCommands(program: Command): void {
  const webhook = program
    .command('webhook')
    .alias('webhooks')
    .description('Webhooks that receive post and account events');

  webhook
    .command('create')
    .description('Register a webhook; the signing secret is returned only here')
    .option('--url <url>', 'HTTPS endpoint that receives the events')
    .action(async (options: CreateOptions) => {
      await runCreate(options);
    });

  webhook
    .command('list')
    .alias('ls')
    .description('List the webhooks in this workspace')
    .action(async () => {
      await runList();
    });

  webhook
    .command('view <id>')
    .alias('get')
    .description('Show one webhook')
    .action(async (id: string) => {
      await runView(id);
    });

  webhook
    .command('update <id>')
    .description('Change the URL or turn a webhook on or off. Events are not editable')
    .option('--url <url>', 'New endpoint')
    .option('--active', 'Turn deliveries on')
    .option('--inactive', 'Turn deliveries off')
    .action(async (id: string, options: UpdateOptions) => {
      await runUpdate(id, options);
    });

  webhook
    .command('delete <id>')
    .alias('rm')
    .description('Delete a webhook')
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runDelete(id, command.optsWithGlobals() as GlobalOptions);
    });

  webhook
    .command('test <id>')
    .description('Send a test delivery and report what the endpoint answered')
    .action(async (id: string) => {
      await runTest(id);
    });
}
