import type { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  PRODUCT,
  dim,
  hint,
  print,
  printResult,
  redactToken,
  resolveProfile,
  usageError,
} from '../core/index.js';

const SERVER_NAME = PRODUCT.id;
const HOSTED_URL = 'https://mcp.adaptlypost.com/mcp';
const LOCAL_PACKAGE = '@adaptlypost/mcp-server';
const TOKEN_ENV = `${PRODUCT.envPrefix}_API_TOKEN`;

const CLIENTS = ['claude', 'cursor', 'vscode', 'windsurf', 'codex', 'json'] as const;

type Client = (typeof CLIENTS)[number];

const CONFIG_FILES: Record<Client, string> = {
  claude: join(homedir(), '.claude.json'),
  cursor: join(homedir(), '.cursor', 'mcp.json'),
  vscode: join('.vscode', 'mcp.json'),
  windsurf: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
  codex: join(homedir(), '.codex', 'config.toml'),
  json: join(homedir(), `.${SERVER_NAME}-mcp.json`),
};

function serverEntry(token: string, local: boolean): Record<string, unknown> {
  if (local) {
    return { command: 'npx', args: ['-y', LOCAL_PACKAGE], env: { [TOKEN_ENV]: token } };
  }
  return {
    type: 'http',
    url: HOSTED_URL,
    headers: { Authorization: `Bearer ${token}` },
  };
}

function snippetFor(client: Client, token: string, local: boolean): string {
  if (client === 'codex') {
    const lines = [`[mcp_servers.${SERVER_NAME}]`];
    if (local) {
      lines.push('command = "npx"', `args = ["-y", "${LOCAL_PACKAGE}"]`, `env = { ${TOKEN_ENV} = "${token}" }`);
    } else {
      lines.push(`url = "${HOSTED_URL}"`, `http_headers = { Authorization = "Bearer ${token}" }`);
    }
    return lines.join('\n');
  }
  const key = client === 'vscode' ? 'servers' : 'mcpServers';
  return JSON.stringify({ [key]: { [SERVER_NAME]: serverEntry(token, local) } }, null, 2);
}

function addCommandFor(token: string, local: boolean): string {
  return local
    ? `claude mcp add ${SERVER_NAME} --env ${TOKEN_ENV}=${token} -- npx -y ${LOCAL_PACKAGE}`
    : `claude mcp add --transport http ${SERVER_NAME} ${HOSTED_URL} --header "Authorization: Bearer ${token}"`;
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description(`print the ${PRODUCT.displayName} MCP server config for your editor`)
    .option('--client <client>', `one of ${CLIENTS.join(', ')}`, 'claude')
    .option('--local', 'use the stdio server from npm instead of the hosted one')
    .option('--write', 'name the file this config belongs in, without touching it')
    .option('--install', 'alias of --write')
    .action((options: { client: string; local?: boolean; write?: boolean; install?: boolean }) => {
      const client = options.client.toLowerCase() as Client;
      if (!(CLIENTS as readonly string[]).includes(client)) {
        throw usageError(
          `Unknown MCP client "${options.client}".`,
          `Supported clients: ${CLIENTS.join(', ')}`,
        );
      }

      let token: string | undefined;
      let profileName = 'default';
      try {
        const profile = resolveProfile();
        token = profile.token;
        profileName = profile.name;
      } catch {
        token = undefined;
      }

      const local = Boolean(options.local);
      const write = Boolean(options.write || options.install);
      const reveal = write || !process.stdout.isTTY;
      const placeholder = `\${${TOKEN_ENV}}`;
      const real = token ?? placeholder;
      const shown = token && !reveal ? redactToken(token) : real;
      const file = CONFIG_FILES[client];

      printResult('mcp', {
        client,
        transport: local ? 'stdio' : 'http',
        url: local ? null : HOSTED_URL,
        package: local ? LOCAL_PACKAGE : null,
        configFile: file,
        config: client === 'codex' ? snippetFor(client, real, local) : JSON.parse(snippetFor(client, real, local)),
      });

      if (client === 'claude') {
        print(`Add the ${PRODUCT.displayName} MCP server to Claude Code:`);
        print('');
        print(`  ${addCommandFor(shown, local)}`);
        print('');
        print('Or paste this into your MCP config:');
      } else {
        print(`Paste this into ${file}:`);
      }
      print('');
      for (const line of snippetFor(client, shown, local).split('\n')) print(`  ${line}`);
      print('');

      if (!token) {
        hint(`Profile "${profileName}" has no token, the config above carries a placeholder. Run: ${PRODUCT.binName} login`);
      } else if (!reveal) {
        hint('The token is redacted on screen. Re-run with --write, or pipe this command, to get it in full.');
      }
      if (write) {
        print(`${dim('config file')}  ${file}`);
        hint('Nothing was written. Merge the block above into that file yourself, it may already hold other servers.');
      }
    });
}
