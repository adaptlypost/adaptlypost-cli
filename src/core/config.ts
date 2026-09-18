import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CliError } from './errors.js';
import { ExitCode } from './exit-codes.js';
import { readCredentials } from './credentials.js';
import { PRODUCT } from '../product.js';

export { PRODUCT };

export const CONFIG_VERSION = 1;

export const LANGUAGES = ['en', 'fr', 'de', 'es', 'pt'] as const;

export type Language = (typeof LANGUAGES)[number];

export interface ProfileDefaults {
  timezone?: string;
  defaultPlatforms?: string[];
  defaultSite?: string;
  defaultWebsite?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

export interface LastUpdateCheck {
  checked: string;
  latest: string;
}

export interface ConfigFile {
  version: number;
  updateCheck?: boolean;
  language?: Language;
  lastUpdateCheck?: LastUpdateCheck;
  profiles: Record<string, ProfileDefaults>;
  [key: string]: unknown;
}

export type TokenSource = 'flag' | 'env-token' | 'env-key' | 'credentials';

export type ApiUrlSource = 'flag' | 'env' | 'credentials' | 'default';

export interface ResolvedProfile {
  name: string;
  token: string;
  tokenSource: TokenSource;
  apiUrl: string;
  workspaceId?: string;
  defaults: ProfileDefaults;
}

export interface ResolveProfileOptions {
  profile?: string;
  token?: string;
  apiUrl?: string;
}

export interface GlobalOptions extends ResolveProfileOptions {
  json?: boolean;
  quiet?: boolean;
  color?: boolean;
  debug?: boolean;
  yes?: boolean;
  input?: boolean;
  lang?: string;
  fullIds?: boolean;
}

let globalOptions: GlobalOptions = {};

export function setGlobalOptions(options: GlobalOptions): void {
  globalOptions = { ...options };
}

export function getGlobalOptions(): GlobalOptions {
  return globalOptions;
}

export function envVar(suffix: string): string {
  return `${PRODUCT.envPrefix}_${suffix}`;
}

function env(suffix: string): string | undefined {
  const value = process.env[envVar(suffix)];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function configDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    if (appData) return join(appData, PRODUCT.displayName);
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg !== '' ? xdg : join(homedir(), '.config');
  return join(base, PRODUCT.id);
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}

export function ensureConfigDir(): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function writeFileAtomic(path: string, contents: string, mode: number): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, contents, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw new CliError(`Could not write ${path}: ${(error as Error).message}`, {
      exitCode: ExitCode.GENERIC,
      cause: error,
    });
  }
}

function emptyConfig(): ConfigFile {
  return { version: CONFIG_VERSION, profiles: {} };
}

export function readConfig(): ConfigFile {
  const path = configPath();
  if (!existsSync(path)) return emptyConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CliError(`${path} is not valid JSON`, {
      exitCode: ExitCode.GENERIC,
      hint: `Fix the file or delete it: rm ${path}`,
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyConfig();
  const raw = parsed as Partial<ConfigFile>;
  const profiles = raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  return { ...raw, version: raw.version ?? CONFIG_VERSION, profiles } as ConfigFile;
}

export function writeConfig(config: ConfigFile): void {
  ensureConfigDir();
  writeFileAtomic(configPath(), `${JSON.stringify(config, null, 2)}\n`, 0o644);
}

export function updateConfig(mutate: (config: ConfigFile) => void): ConfigFile {
  const config = readConfig();
  mutate(config);
  writeConfig(config);
  return config;
}

export type ConfigScope = 'global' | 'profile';

export interface ConfigKeyDefinition {
  key: string;
  scope: ConfigScope;
  description: string;
  products: readonly string[] | 'all';
  parse: (raw: string) => unknown;
  format: (value: unknown) => string;
}

function parseBoolean(key: string): (raw: string) => boolean {
  return (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off'].includes(value)) return false;
    throw new CliError(`${key} must be true or false, got "${raw}"`, { exitCode: ExitCode.USAGE });
  };
}

function parseTimezone(raw: string): string {
  const value = raw.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new CliError(`"${value}" is not an IANA timezone`, {
      exitCode: ExitCode.USAGE,
      hint: 'Use a name such as Europe/Berlin or America/New_York',
    });
  }
  return value;
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== '');
}

function parseNonEmpty(key: string): (raw: string) => string {
  return (raw: string) => {
    const value = raw.trim();
    if (value === '') throw new CliError(`${key} cannot be empty`, { exitCode: ExitCode.USAGE });
    return value;
  };
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

export const CONFIG_KEYS: Record<string, ConfigKeyDefinition> = {
  updateCheck: {
    key: 'updateCheck',
    scope: 'global',
    products: 'all',
    description: 'Check npm for a newer CLI once a day',
    parse: parseBoolean('updateCheck'),
    format: formatValue,
  },
  language: {
    key: 'language',
    scope: 'global',
    products: 'all',
    description: `Value of the x-language header (${LANGUAGES.join(' ')})`,
    parse: (raw) => {
      const value = raw.trim().toLowerCase();
      if (!(LANGUAGES as readonly string[]).includes(value)) {
        throw new CliError(`language must be one of ${LANGUAGES.join(', ')}, got "${raw}"`, {
          exitCode: ExitCode.USAGE,
        });
      }
      return value as Language;
    },
    format: formatValue,
  },
  timezone: {
    key: 'timezone',
    scope: 'profile',
    products: ['adaptlypost'],
    description: 'Default value for --timezone',
    parse: parseTimezone,
    format: formatValue,
  },
  defaultPlatforms: {
    key: 'defaultPlatforms',
    scope: 'profile',
    products: ['adaptlypost'],
    description: 'Default value for --platform, comma separated',
    parse: parseList,
    format: formatValue,
  },
  defaultSite: {
    key: 'defaultSite',
    scope: 'profile',
    products: ['redreplier'],
    description: 'Default value for --site',
    parse: parseNonEmpty('defaultSite'),
    format: formatValue,
  },
  defaultWebsite: {
    key: 'defaultWebsite',
    scope: 'profile',
    products: ['flowsery'],
    description: 'Default website for reporting commands',
    parse: parseNonEmpty('defaultWebsite'),
    format: formatValue,
  },
  workspaceId: {
    key: 'workspaceId',
    scope: 'profile',
    products: 'all',
    description: 'Workspace this profile talks to',
    parse: parseNonEmpty('workspaceId'),
    format: formatValue,
  },
};

function appliesToProduct(definition: ConfigKeyDefinition): boolean {
  return definition.products === 'all' || definition.products.includes(PRODUCT.id);
}

export function productConfigKeys(): ConfigKeyDefinition[] {
  return Object.values(CONFIG_KEYS).filter(appliesToProduct);
}

export function configKey(key: string): ConfigKeyDefinition {
  const definition = CONFIG_KEYS[key];
  if (!definition || !appliesToProduct(definition)) {
    throw new CliError(`Unknown config key "${key}"`, {
      exitCode: ExitCode.USAGE,
      hint: `Known keys: ${productConfigKeys()
        .map((entry) => entry.key)
        .join(', ')}`,
    });
  }
  return definition;
}

export interface ConfigEntry {
  key: string;
  scope: ConfigScope;
  value: unknown;
  description: string;
}

export function getConfigValue(key: string, profileName?: string): unknown {
  const definition = configKey(key);
  const config = readConfig();
  if (definition.scope === 'global') return config[definition.key];
  const name = profileName ?? resolveProfileName();
  return config.profiles[name]?.[definition.key];
}

export function setConfigValue(key: string, raw: string, profileName?: string): unknown {
  const definition = configKey(key);
  const value = definition.parse(raw);
  const name = profileName ?? resolveProfileName();
  updateConfig((config) => {
    if (definition.scope === 'global') {
      config[definition.key] = value;
      return;
    }
    const profile = config.profiles[name] ?? {};
    profile[definition.key] = value;
    config.profiles[name] = profile;
  });
  return value;
}

export function unsetConfigValue(key: string, profileName?: string): boolean {
  const definition = configKey(key);
  const name = profileName ?? resolveProfileName();
  let existed = false;
  updateConfig((config) => {
    if (definition.scope === 'global') {
      existed = config[definition.key] !== undefined;
      delete config[definition.key];
      return;
    }
    const profile = config.profiles[name];
    if (!profile) return;
    existed = profile[definition.key] !== undefined;
    delete profile[definition.key];
  });
  return existed;
}

export function listConfigValues(profileName?: string): { profile: string; entries: ConfigEntry[] } {
  const name = profileName ?? resolveProfileName();
  const config = readConfig();
  const entries = productConfigKeys().map((definition) => ({
    key: definition.key,
    scope: definition.scope,
    description: definition.description,
    value:
      definition.scope === 'global'
        ? config[definition.key]
        : config.profiles[name]?.[definition.key],
  }));
  return { profile: name, entries };
}

export function profileDefaults(profileName?: string): ProfileDefaults {
  const name = profileName ?? resolveProfileName();
  return readConfig().profiles[name] ?? {};
}

export function resolveProfileName(options: ResolveProfileOptions = globalOptions): string {
  const fromFlag = options.profile?.trim();
  if (fromFlag) return fromFlag;
  const fromEnv = env('PROFILE');
  if (fromEnv) return fromEnv;
  const credentials = readCredentials();
  const current = credentials.current?.trim();
  if (current && credentials.profiles[current]) return current;
  return current || 'default';
}

export function resolveApiUrl(
  options: ResolveProfileOptions = globalOptions,
  storedApiUrl?: string,
): { url: string; source: ApiUrlSource } {
  const fromFlag = options.apiUrl?.trim();
  if (fromFlag) return { url: normalizeApiUrl(fromFlag, '--api-url'), source: 'flag' };
  const fromEnv = env('API_URL');
  if (fromEnv) return { url: normalizeApiUrl(fromEnv, envVar('API_URL')), source: 'env' };
  const stored = storedApiUrl?.trim();
  if (stored) return { url: normalizeApiUrl(stored, 'credentials.json apiUrl'), source: 'credentials' };
  return { url: PRODUCT.defaultApiUrl, source: 'default' };
}

export function normalizeApiUrl(value: string, origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError(`${origin} is not a valid URL: ${value}`, { exitCode: ExitCode.USAGE });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new CliError(`${origin} must be an http or https URL: ${value}`, { exitCode: ExitCode.USAGE });
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function describeTokenSource(source: TokenSource): string {
  switch (source) {
    case 'flag':
      return '--token flag';
    case 'env-token':
      return envVar('API_TOKEN');
    case 'env-key':
      return envVar('API_KEY');
    case 'credentials':
      return 'credentials file';
  }
}

export function describeApiUrlSource(source: ApiUrlSource): string {
  switch (source) {
    case 'flag':
      return '--api-url flag';
    case 'env':
      return envVar('API_URL');
    case 'credentials':
      return 'credentials file';
    case 'default':
      return 'product default';
  }
}

export function resolveProfile(options: ResolveProfileOptions = globalOptions): ResolvedProfile {
  const name = resolveProfileName(options);
  const credentials = readCredentials();
  const stored = credentials.profiles[name];
  const defaults = profileDefaults(name);

  const flagToken = options.token?.trim();
  const envToken = env('API_TOKEN');
  const envKey = env('API_KEY');

  let token: string | undefined;
  let tokenSource: TokenSource;
  if (flagToken) {
    token = flagToken;
    tokenSource = 'flag';
  } else if (envToken) {
    token = envToken;
    tokenSource = 'env-token';
  } else if (envKey) {
    token = envKey;
    tokenSource = 'env-key';
  } else {
    token = stored?.token;
    tokenSource = 'credentials';
  }

  if (!token) {
    throw new CliError(`No API token for profile "${name}"`, {
      exitCode: ExitCode.AUTH,
      hint: `Run ${PRODUCT.binName} login, or set ${envVar('API_TOKEN')}`,
    });
  }

  const workspaceId = env('WORKSPACE_ID') ?? (typeof defaults.workspaceId === 'string' ? defaults.workspaceId : undefined);

  return {
    name,
    token,
    tokenSource,
    apiUrl: resolveApiUrl(options, stored?.apiUrl).url,
    ...(workspaceId ? { workspaceId } : {}),
    defaults,
  };
}

export function resolveLanguage(flagLanguage: string | undefined = globalOptions.lang): Language | undefined {
  const raw = flagLanguage?.trim() ?? readConfig().language;
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (!(LANGUAGES as readonly string[]).includes(value)) {
    throw new CliError(`--lang must be one of ${LANGUAGES.join(', ')}, got "${raw}"`, {
      exitCode: ExitCode.USAGE,
    });
  }
  return value as Language;
}

export function isDebugEnabled(flagDebug: boolean | undefined = globalOptions.debug): boolean {
  if (flagDebug) return true;
  const value = env('DEBUG');
  return value !== undefined && value !== '0' && value.toLowerCase() !== 'false';
}
