#!/usr/bin/env node
const NODE_FLOOR = '22.12.0';

function isBelow(current: string, floor: string): boolean {
  const left = current.split('.');
  const right = floor.split('.');
  for (let i = 0; i < 3; i += 1) {
    const a = Number.parseInt(left[i] ?? '0', 10) || 0;
    const b = Number.parseInt(right[i] ?? '0', 10) || 0;
    if (a !== b) return a < b;
  }
  return false;
}

if (isBelow(process.versions.node, NODE_FLOOR)) {
  process.stderr.write(
    `adaptlypost needs Node ${NODE_FLOOR} or newer, this is Node ${process.versions.node}. ` +
      'Install a current Node from https://nodejs.org and try again.\n',
  );
  process.exit(2);
}

import type { Command, Option as CommanderOption } from 'commander';
import type { GlobalOptions } from './core/config.js';

type Registrar = (program: Command) => void;

const { Command: Program, Option } = await import('commander');
const { ExitCode } = await import('./core/exit-codes.js');
const { PRODUCT, setGlobalOptions } = await import('./core/config.js');
const { versionLine } = await import('./core/version.js');

const GLOBAL_OPTION_SPECS: Array<[flags: string, description: string]> = [
  ['-p, --profile <name>', 'credential profile to use'],
  ['--json', 'force machine-readable JSON output'],
  ['-q, --quiet', 'suppress spinners, hints and notices'],
  ['--no-color', 'strip ANSI colour from the output'],
  ['--debug', 'log every request to stderr'],
  ['--api-url <url>', 'override the API base URL'],
  ['--token <token>', 'use this token for one invocation'],
  ['-y, --yes', 'answer yes to every confirmation'],
  ['--no-input', 'never prompt, fail with exit 2 instead'],
  ['--lang <code>', 'language for the x-language header: en, fr, de, es, pt'],
  ['--full-ids', 'print identifiers in full instead of truncating'],
];

const GLOBAL_KEYS = [
  'profile',
  'json',
  'quiet',
  'color',
  'debug',
  'apiUrl',
  'token',
  'yes',
  'input',
  'lang',
  'fullIds',
] as const;

const VALUE_TAKING_GLOBALS = new Set(['-p', '--profile', '--api-url', '--token', '--lang']);

const MODULES: Array<{ names: string[]; load: () => Promise<Registrar> }> = [
  {
    names: ['login', 'logout', 'whoami'],
    load: async () => (await import('./commands/auth.js')).registerAuthCommands,
  },
  {
    names: ['config'],
    load: async () => (await import('./commands/config.js')).registerConfigCommands,
  },
  {
    names: ['doctor'],
    load: async () => (await import('./commands/doctor.js')).registerDoctorCommand,
  },
  {
    names: ['completion'],
    load: async () => (await import('./commands/completion.js')).registerCompletionCommand,
  },
  {
    names: ['mcp'],
    load: async () => (await import('./commands/mcp.js')).registerMcpCommand,
  },
  {
    names: ['api'],
    load: async () => (await import('./commands/api.js')).registerApiCommand,
  },
  {
    names: ['open'],
    load: async () => (await import('./commands/open.js')).registerOpenCommand,
  },
  {
    names: ['post'],
    load: async () => (await import('./commands/post.js')).registerPostCommands,
  },
  {
    names: ['accounts', 'account'],
    load: async () => (await import('./commands/account.js')).registerAccountCommands,
  },
  {
    names: ['analytics'],
    load: async () => (await import('./commands/analytics.js')).registerAnalyticsCommands,
  },
  {
    names: ['media'],
    load: async () => (await import('./commands/media.js')).registerMediaCommands,
  },
];

function firstCommandToken(argv: string[]): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--') return undefined;
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && VALUE_TAKING_GLOBALS.has(arg)) i += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

function wantsEverything(argv: string[], token: string | undefined): boolean {
  const rest = argv.slice(2);
  if (rest.includes('-h') || rest.includes('--help')) return true;
  if (token === undefined) return !rest.includes('-V') && !rest.includes('--version');
  if (token === 'help' || token === 'completion') return true;
  return !MODULES.some((entry) => entry.names.includes(token));
}

async function registerCommands(target: Command, argv: string[]): Promise<void> {
  const token = firstCommandToken(argv);
  const wanted = wantsEverything(argv, token)
    ? MODULES
    : MODULES.filter((entry) => entry.names.includes(token as string));
  for (const entry of wanted) {
    const register = await entry.load();
    register(target);
  }
}

function conflicts(command: Command, option: CommanderOption): boolean {
  for (const existing of command.options) {
    if (existing.attributeName() === option.attributeName()) return true;
    if (option.short && (existing.short === option.short || existing.long === option.short)) return true;
    if (option.long && (existing.long === option.long || existing.short === option.long)) return true;
  }
  return false;
}

function addGlobalOptions(command: Command): void {
  for (const [flags, description] of GLOBAL_OPTION_SPECS) {
    const option = new Option(flags, description).hideHelp(command.parent !== null);
    if (conflicts(command, option)) continue;
    command.addOption(option);
  }
  for (const child of command.commands) addGlobalOptions(child);
}

function collectGlobals(command: Command): GlobalOptions {
  const chain: Command[] = [];
  for (let node: Command | null = command; node; node = node.parent) chain.unshift(node);
  const globals: Record<string, unknown> = {};
  for (const node of chain) {
    for (const key of GLOBAL_KEYS) {
      const source = node.getOptionValueSource(key);
      if (source === 'cli' || source === 'env') globals[key] = node.getOptionValue(key);
    }
  }
  if (globals.color === undefined) globals.color = true;
  if (globals.input === undefined) globals.input = Boolean(process.stdin.isTTY);
  return globals as GlobalOptions;
}

function commandPath(command: Command): string {
  const parts: string[] = [];
  for (let node: Command | null = command; node && node.parent; node = node.parent) {
    parts.unshift(node.name());
  }
  return parts.join('.') || command.name();
}

let currentCommand: string = PRODUCT.binName;
let currentGlobals: GlobalOptions = {};
let commanderOutput = '';

function isCommanderError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('commander.');
}

async function reportFailure(error: unknown): Promise<number> {
  const { isMachine, printError } = await import('./core/output.js');

  if (isCommanderError(error)) {
    if (error.code === 'commander.version' || error.code === 'commander.helpDisplayed') {
      process.stdout.write(commanderOutput);
      return ExitCode.OK;
    }
    if (error.code === 'commander.help') {
      process.stderr.write(commanderOutput);
      return ExitCode.USAGE;
    }
    if (isMachine()) {
      const { usageError } = await import('./core/errors.js');
      return printError(usageError(commanderOutput.trim() || error.message), currentCommand);
    }
    process.stderr.write(commanderOutput);
    return ExitCode.USAGE;
  }

  process.stderr.write(commanderOutput);
  return printError(error, currentCommand);
}

process.on('SIGINT', () => {
  process.stderr.write('\n');
  process.exit(ExitCode.CANCELLED);
});

const program = new Program();

program
  .name(PRODUCT.binName)
  .description(`${PRODUCT.displayName} from your terminal`)
  .version(versionLine(PRODUCT.binName), '-V, --version', 'print the version, node and platform')
  .helpOption('-h, --help', 'show help for a command')
  .showSuggestionAfterError(true)
  .enablePositionalOptions()
  .exitOverride()
  .configureOutput({
    writeErr: (text) => {
      commanderOutput += text;
    },
    writeOut: (text) => {
      commanderOutput += text;
    },
  });

program.hook('preAction', async (_root, actionCommand) => {
  const globals = collectGlobals(actionCommand);
  const path = commandPath(actionCommand);
  currentCommand = path;
  currentGlobals = globals;
  setGlobalOptions(globals);

  const { detectColorEnabled, setColorEnabled } = await import('./core/color.js');
  const { setInteractive } = await import('./core/prompt.js');
  const { configureHttp } = await import('./core/http.js');

  setColorEnabled(detectColorEnabled({ noColor: globals.color === false }));
  initOutput({
    json: globals.json,
    quiet: globals.quiet,
    fullIds: globals.fullIds,
    command: path,
    envPrefix: PRODUCT.envPrefix,
  });
  setInteractive(globals.input !== false);
  configureHttp(globals);
});

for (const [flags, description] of GLOBAL_OPTION_SPECS) {
  program.addOption(new Option(flags, description));
}

await registerCommands(program, process.argv);
addGlobalOptions(program);

const { initOutput } = await import('./core/output.js');
initOutput({ json: process.argv.includes('--json'), envPrefix: PRODUCT.envPrefix });

try {
  await program.parseAsync(process.argv);
  process.stdout.write(commanderOutput);
  commanderOutput = '';
  const { runUpdateCheck } = await import('./core/update-check.js');
  await runUpdateCheck({ quiet: currentGlobals.quiet === true });
  if (process.exitCode === undefined) process.exitCode = ExitCode.OK;
} catch (error) {
  process.exitCode = await reportFailure(error);
}
