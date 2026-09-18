import type { Command } from 'commander';

import { PRODUCT, getGlobalOptions, openUrl, print, printResult, usageError } from '../core/index.js';

interface Target {
  path: (id?: string) => string;
  needsId: boolean;
}

const TARGETS: Record<string, Target> = {
  dashboard: { path: () => '/dashboard', needsId: false },
  calendar: { path: () => '/calendar', needsId: false },
  create: { path: () => '/create-post', needsId: false },
  scheduled: { path: () => '/scheduled', needsId: false },
  posted: { path: () => '/posted', needsId: false },
  drafts: { path: () => '/drafts', needsId: false },
  accounts: { path: () => '/connectors', needsId: false },
  analytics: { path: () => '/analytics', needsId: false },
  tokens: { path: () => '/api-tokens', needsId: false },
  billing: { path: () => '/billing', needsId: false },
  settings: { path: () => '/settings/general', needsId: false },
  workspaces: { path: () => '/workspaces', needsId: false },
};

const ALIASES: Record<string, string> = {
  home: 'dashboard',
  account: 'accounts',
  connectors: 'accounts',
  token: 'tokens',
  'api-tokens': 'tokens',
  stats: 'analytics',
  draft: 'drafts',
  'create-post': 'create',
  new: 'create',
  workspace: 'workspaces',
};

export function registerOpenCommand(program: Command): void {
  program
    .command('open')
    .argument('[what]', `one of ${Object.keys(TARGETS).join(', ')}`, 'dashboard')
    .argument('[id]', 'identifier, for the targets that need one')
    .description(`open the ${PRODUCT.displayName} web app in your browser`)
    .action((what: string, id: string | undefined) => {
      const name = ALIASES[what.toLowerCase()] ?? what.toLowerCase();
      const target = TARGETS[name];

      if (!target) {
        throw usageError(
          `There is nothing to open called "${what}".`,
          `Targets: ${Object.keys(TARGETS).join(', ')}`,
        );
      }
      if (target.needsId && id === undefined) {
        throw usageError(`open ${name} needs an id.`, `${PRODUCT.binName} open ${name} <id>`);
      }

      const url = `${PRODUCT.appUrl}${target.path(id)}`;

      printResult('open', { target: name, url });

      if (getGlobalOptions().input === false) {
        print(url);
        return;
      }
      print(openUrl(url) ? `Opening ${url}` : url);
    });
}
