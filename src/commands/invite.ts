import type { Command } from 'commander';

import { getMe, listInvitations, revokeInvitation, sendInvitation } from '../api/client.js';
import {
  CREDIT_ALLOWANCE_MAX,
  WORKSPACE_ROLES,
  type CreditAllowance,
  type Invitation,
  type InvitationWorkspace,
  type SendInvitationRequest,
  type WorkspaceRole,
} from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  formatAbsolute,
  formatId,
  formatRelative,
  hint,
  isMachine,
  isQuiet,
  paginateAll,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  promptConfirm,
  success,
  usageError,
  validateLimit,
  validateOffset,
} from '../core/index.js';

interface GlobalOptions {
  yes?: boolean;
  quiet?: boolean;
}

export interface InviteSendOptions {
  workspace: string[];
  role?: string;
  orgAdmin?: boolean;
  monthlyCredits?: string;
  fixedCredits?: string;
}

interface ListOptions extends GlobalOptions {
  limit?: string;
  offset?: string;
  all?: boolean;
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const parseWorkspaceRole = (value: string, flag = '--role'): WorkspaceRole => {
  const role = value.trim().toLowerCase();
  if (!(WORKSPACE_ROLES as readonly string[]).includes(role)) {
    throw usageError(`Unknown role "${value}" in ${flag}.`, `Roles: ${WORKSPACE_ROLES.join(', ')}`);
  }
  return role as WorkspaceRole;
};

const parseCredits = (flag: string, value: string, min: number): number => {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < min || amount > CREDIT_ALLOWANCE_MAX) {
    throw usageError(`${flag} must be an integer between ${min} and ${CREDIT_ALLOWANCE_MAX}.`);
  }
  return amount;
};

export function parseInviteWorkspaces(values: readonly string[], role: string | undefined): InvitationWorkspace[] {
  const fallback = role === undefined ? undefined : parseWorkspaceRole(role);
  const workspaces: InvitationWorkspace[] = [];
  for (const value of values) {
    const [rawId = '', rawRole, ...rest] = value.split(':');
    const workspaceId = rawId.trim();
    if (!workspaceId || rest.length > 0) {
      throw usageError(`"${value}" is not a workspace.`, 'Pass --workspace <id> or --workspace <id>:<role>');
    }
    const workspaceRole = rawRole === undefined ? fallback : parseWorkspaceRole(rawRole, '--workspace');
    if (workspaceRole === undefined) {
      throw usageError(`No role for workspace ${workspaceId}.`, `Add --role, or pass --workspace ${workspaceId}:editor`);
    }
    if (workspaces.some((entry) => entry.workspaceId === workspaceId)) {
      throw usageError(`Workspace ${workspaceId} is listed twice.`);
    }
    workspaces.push({ workspaceId, role: workspaceRole });
  }
  return workspaces;
}

export function buildInvitation(
  email: string,
  options: InviteSendOptions,
  currentWorkspaceId?: string,
): SendInvitationRequest {
  const address = email.trim();
  if (!EMAIL.test(address)) throw usageError(`"${email}" is not an email address.`);

  let workspaces = parseInviteWorkspaces(options.workspace, options.role);
  if (workspaces.length === 0) {
    if (options.role === undefined) {
      throw usageError('--role is required.', `invite send ${address} --role editor`);
    }
    if (!currentWorkspaceId) throw usageError('Pass --workspace <id>:<role>.');
    workspaces = [{ workspaceId: currentWorkspaceId, role: parseWorkspaceRole(options.role) }];
  }

  if (options.monthlyCredits !== undefined && options.fixedCredits !== undefined) {
    throw usageError('Pass --monthly-credits or --fixed-credits, not both.');
  }
  let creditAllowance: CreditAllowance | undefined;
  if (options.monthlyCredits !== undefined) {
    creditAllowance = { mode: 'MONTHLY', monthlyAmount: parseCredits('--monthly-credits', options.monthlyCredits, 1) };
  }
  if (options.fixedCredits !== undefined) {
    creditAllowance = { mode: 'FIXED', balance: parseCredits('--fixed-credits', options.fixedCredits, 0) };
  }

  return {
    email: address,
    workspaces,
    ...(options.orgAdmin && { organizationRole: 'org-admin' as const }),
    ...(creditAllowance && { creditAllowance }),
  };
}

const workspacesOf = (invitation: Invitation): string =>
  invitation.workspaces
    .map((workspace) => `${workspace.workspaceName ?? formatId(workspace.workspaceId)}: ${workspace.role}`)
    .join(', ') || '—';

const detailsOf = (invitation: Invitation): [string, string][] => [
  ['id', invitation.id],
  ['email', invitation.email],
  ['status', invitation.status],
  ['organization role', invitation.organizationRole],
  ['workspaces', workspacesOf(invitation)],
  ['expires', `${formatAbsolute(new Date(invitation.expiresAt))} (${formatRelative(new Date(invitation.expiresAt))})`],
];

async function runSend(email: string, options: InviteSendOptions): Promise<void> {
  const needsCurrent = options.workspace.length === 0 && options.role !== undefined;
  const currentWorkspaceId = needsCurrent ? (await getMe()).workspace.id : undefined;
  const invitation = await sendInvitation(buildInvitation(email, options, currentWorkspaceId));

  if (isMachine()) {
    printResult('invite.send', invitation);
    return;
  }

  success(`Invitation sent to ${invitation.email}`);
  printKeyValues(detailsOf(invitation));
  hint(`Revoke it with: ${PRODUCT.binName} invite revoke ${invitation.id}`);
}

async function runList(options: ListOptions): Promise<void> {
  const limit = options.limit === undefined ? 20 : validateLimit(options.limit, 1, 100);
  const offset = validateOffset(options.offset);

  let invitations: Invitation[];
  let total: number | undefined;
  let hasMore = false;

  if (options.all) {
    const paged = await paginateAll<Invitation>({
      pageSize: 100,
      offset,
      quiet: Boolean(options.quiet) || isQuiet(),
      fetchPage: async (page) => {
        const response = await listInvitations({ limit: page.limit, offset: page.offset });
        return { items: response.invitations, total: response.total, hasMore: response.hasMore };
      },
    });
    invitations = paged.items;
    total = paged.total;
  } else {
    const response = await listInvitations({ limit, offset });
    invitations = response.invitations;
    total = response.total;
    hasMore = response.hasMore;
  }

  if (isMachine()) {
    printResult('invite.list', invitations, {
      total,
      limit: options.all ? undefined : limit,
      offset: options.all ? undefined : offset,
      hasMore,
    });
    printFieldHints(invitations);
    return;
  }

  if (invitations.length === 0) {
    print('No invitations for this workspace.');
    return;
  }

  printTable(invitations, [
    { header: 'ID', value: (invitation) => formatId(invitation.id) },
    { header: 'EMAIL', value: (invitation) => invitation.email },
    { header: 'STATUS', value: (invitation) => invitation.status },
    { header: 'ORG ROLE', value: (invitation) => invitation.organizationRole },
    { header: 'WORKSPACES', value: workspacesOf },
    { header: 'EXPIRES', value: (invitation) => formatAbsolute(new Date(invitation.expiresAt), { withZone: false }) },
  ]);

  print();
  print(`${invitations.length} of ${total ?? invitations.length}`);
  if (hasMore) print(`next: --offset ${offset + invitations.length}`);
}

async function runRevoke(id: string, options: GlobalOptions): Promise<void> {
  const proceed = await promptConfirm(`Revoke invitation ${id}? The link in the email stops working at once.`, {
    assumeYes: Boolean(options.yes),
  });
  if (!proceed) {
    throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
  }

  const revoked = await revokeInvitation(id);

  if (isMachine()) {
    printResult('invite.revoke', revoked);
    return;
  }

  success(`Invitation to ${revoked.email} revoked`);
}

export function registerInviteCommands(program: Command): void {
  const invite = program
    .command('invite')
    .aliases(['invites', 'invitation', 'invitations'])
    .description('Invite people to the organization and its workspaces');

  invite
    .command('send <email>')
    .description('Email an invitation that lasts 7 days')
    .option(
      '--workspace <id[:role]>',
      'workspace to invite them to, repeatable, with its role after a colon. Without it they join this workspace',
      collect,
      [] as string[],
    )
    .option('--role <role>', `role for every workspace without one: ${WORKSPACE_ROLES.join(', ')}`)
    .option('--org-admin', 'make them an organization admin. Only the organization owner can')
    .option('--monthly-credits <n>', 'AI credits they may spend each plan cycle from the owner pool')
    .option('--fixed-credits <n>', 'AI credits they may spend in total from the owner pool')
    .action(async (email: string, options: InviteSendOptions) => {
      await runSend(email, options);
    });

  invite
    .command('list')
    .alias('ls')
    .description('List invitations that include this workspace, newest first')
    .option('--limit <n>', 'Invitations per page, 1 to 100')
    .option('--offset <n>', 'Invitations to skip')
    .option('--all', 'Page until the server runs out')
    .action(async (_options: ListOptions, command: Command) => {
      await runList(command.optsWithGlobals() as ListOptions);
    });

  invite
    .command('revoke <id>')
    .alias('rm')
    .description('Revoke a pending invitation')
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runRevoke(id, command.optsWithGlobals() as GlobalOptions);
    });
}
