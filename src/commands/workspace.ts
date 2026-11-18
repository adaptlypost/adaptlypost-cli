import type { Command } from 'commander';

import { createWorkspace, deleteWorkspace, listWorkspaces } from '../api/client.js';
import {
  WORKSPACE_CONNECTION_LIMIT_MAX,
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  type CreateWorkspaceRequest,
  type CreatedWorkspace,
  type WorkspaceSummary,
} from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  formatId,
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
} from '../core/index.js';

interface GlobalOptions {
  yes?: boolean;
}

export interface WorkspaceCreateOptions {
  name?: string;
  description?: string;
  connectionLimit?: string;
}

const ANGLE_BRACKETS = /[<>]/;

const checkText = (flag: string, value: string, max: number): string => {
  const text = value.trim();
  if (text.length === 0) throw usageError(`${flag} cannot be empty.`);
  if (text.length > max) throw usageError(`${flag} must be at most ${max} characters.`);
  if (ANGLE_BRACKETS.test(text)) throw usageError(`${flag} cannot contain < or >.`);
  return text;
};

export function buildWorkspaceCreate(options: WorkspaceCreateOptions): CreateWorkspaceRequest {
  if (options.name === undefined) {
    throw usageError('--name is required.', 'workspace create --name "Client B"');
  }
  const body: CreateWorkspaceRequest = { name: checkText('--name', options.name, WORKSPACE_NAME_MAX_LENGTH) };
  if (options.description !== undefined) {
    body.description = checkText('--description', options.description, WORKSPACE_DESCRIPTION_MAX_LENGTH);
  }
  if (options.connectionLimit !== undefined) {
    const limit = Number(options.connectionLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > WORKSPACE_CONNECTION_LIMIT_MAX) {
      throw usageError(`--connection-limit must be an integer between 0 and ${WORKSPACE_CONNECTION_LIMIT_MAX}.`);
    }
    body.connectionLimit = limit;
  }
  return body;
}

const detailsOf = (workspace: CreatedWorkspace): [string, string][] => [
  ['id', workspace.id],
  ['name', workspace.name],
  ['description', workspace.description ?? '—'],
  ['organization', workspace.organizationId],
  ['connection limit', workspace.connectionLimit === null ? 'none' : String(workspace.connectionLimit)],
];

async function runList(): Promise<void> {
  const { workspaces } = await listWorkspaces();

  if (isMachine()) {
    printResult('workspace.list', workspaces, { total: workspaces.length, hasMore: false });
    printFieldHints(workspaces);
    return;
  }

  printTable<WorkspaceSummary>(workspaces, [
    { header: 'ID', value: (workspace) => formatId(workspace.id) },
    { header: 'NAME', value: (workspace) => `${workspace.name}${workspace.current ? ' (current)' : ''}` },
    { header: 'ORGANIZATION', value: (workspace) => workspace.organization.name },
    { header: 'ROLE', value: (workspace) => workspace.role.name },
    { header: 'DEFAULT', value: (workspace) => (workspace.isDefault ? 'yes' : '') },
  ]);
  print();
  print(`${workspaces.length} ${workspaces.length === 1 ? 'workspace' : 'workspaces'}`);
}

async function runCreate(options: WorkspaceCreateOptions): Promise<void> {
  const created = await createWorkspace(buildWorkspaceCreate(options));

  if (isMachine()) {
    printResult('workspace.create', created);
    return;
  }

  success(`Workspace created  ${formatId(created.id)}`);
  printKeyValues(detailsOf(created));
  hint(`Invite someone to it with: ${PRODUCT.binName} invite send <email> --workspace ${created.id} --role editor`);
}

async function runDelete(id: string, options: GlobalOptions): Promise<void> {
  if (!options.yes) {
    const { workspaces } = await listWorkspaces();
    const workspace = workspaces.find((candidate) => candidate.id === id);
    const label = workspace ? `${workspace.name} (${formatId(workspace.id)})` : formatId(id);
    const proceed = await promptConfirm(
      `Delete workspace ${label}? Its posts, feeds, inbox, API keys and connect links are deleted with it.`,
      { assumeYes: false },
    );
    if (!proceed) {
      throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
    }
  }

  const deleted = await deleteWorkspace(id);

  if (isMachine()) {
    printResult('workspace.delete', deleted);
    return;
  }

  success('Deleted');
}

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program
    .command('workspace')
    .alias('workspaces')
    .description('Workspaces in your organization');

  workspace
    .command('list')
    .alias('ls')
    .description('List the workspaces this token can reach')
    .action(async () => {
      await runList();
    });

  workspace
    .command('create')
    .description('Create a workspace. Every organization owner and admin becomes its admin')
    .option('--name <name>', `name, unique in the organization, up to ${WORKSPACE_NAME_MAX_LENGTH} characters`)
    .option('--description <text>', `description, up to ${WORKSPACE_DESCRIPTION_MAX_LENGTH} characters`)
    .option('--connection-limit <n>', 'most social accounts the workspace may connect. Leave out for no limit')
    .action(async (options: WorkspaceCreateOptions) => {
      await runCreate(options);
    });

  workspace
    .command('delete <id>')
    .alias('rm')
    .description('Delete a workspace and everything in it')
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runDelete(id, command.optsWithGlobals() as GlobalOptions);
    });
}
