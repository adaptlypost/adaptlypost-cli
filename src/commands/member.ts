import type { Command } from 'commander';

import { listMembers, removeMember, removeOrganizationMember } from '../api/client.js';
import type { WorkspaceMember } from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  formatAbsolute,
  formatId,
  hint,
  isMachine,
  print,
  printFieldHints,
  printResult,
  printTable,
  promptConfirm,
  success,
} from '../core/index.js';

interface GlobalOptions {
  yes?: boolean;
}

interface RemoveOptions extends GlobalOptions {
  organization?: boolean;
}

export const memberName = (member: WorkspaceMember): string =>
  [member.firstName, member.lastName].filter((part) => part && part.trim()).join(' ');

async function runList(): Promise<void> {
  const { members } = await listMembers();

  if (isMachine()) {
    printResult('member.list', members, { total: members.length, hasMore: false });
    printFieldHints(members);
    return;
  }

  if (members.length === 0) {
    print('No members in this workspace.');
    hint(`Invite someone with: ${PRODUCT.binName} invite send <email> --role editor`);
    return;
  }

  printTable(members, [
    { header: 'USER ID', value: (member) => formatId(member.userId) },
    { header: 'EMAIL', value: (member) => member.email },
    { header: 'NAME', value: (member) => memberName(member) || '—' },
    { header: 'ROLE', value: (member) => member.role },
    { header: 'ORGANIZATION', value: (member) => member.organizationRoles.join(', ') || '—' },
    { header: 'JOINED', value: (member) => formatAbsolute(new Date(member.joinedAt), { withZone: false }) },
  ]);
  print();
  print(`${members.length} ${members.length === 1 ? 'member' : 'members'}`);
}

async function describeMember(userId: string): Promise<string> {
  const { members } = await listMembers();
  const member = members.find((candidate) => candidate.userId === userId);
  return member ? `${member.email} (${formatId(member.userId)})` : formatId(userId);
}

async function runRemove(userId: string, options: RemoveOptions): Promise<void> {
  if (!options.yes) {
    const label = await describeMember(userId);
    const message = options.organization
      ? `Remove ${label} from the organization and every workspace in it? Their API keys and connect links are revoked.`
      : `Remove ${label} from this workspace? Their API keys and connect links here are revoked. They stay in the organization.`;
    const proceed = await promptConfirm(message, { assumeYes: false });
    if (!proceed) {
      throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
    }
  }

  const removed = options.organization ? await removeOrganizationMember(userId) : await removeMember(userId);

  if (isMachine()) {
    printResult(options.organization ? 'member.remove-organization' : 'member.remove', removed);
    return;
  }

  success(options.organization ? 'Removed from the organization' : 'Removed from this workspace');
}

export function registerMemberCommands(program: Command): void {
  const member = program
    .command('member')
    .alias('members')
    .description('People in this workspace and the organization');

  member
    .command('list')
    .alias('ls')
    .description('List the members of this workspace with their roles')
    .action(async () => {
      await runList();
    });

  member
    .command('remove <userId>')
    .alias('rm')
    .description('Remove someone from this workspace, or with --organization from the whole organization')
    .option(
      '--organization',
      'remove them from the organization and every workspace in it. Needs a key created by an organization owner or admin',
    )
    .action(async (userId: string, _options: RemoveOptions, command: Command) => {
      await runRemove(userId, command.optsWithGlobals() as RemoveOptions);
    });
}
