import { existsSync, readFileSync, statSync } from 'node:fs';
import { CliError } from './errors.js';
import { ExitCode } from './exit-codes.js';
import { credentialsPath, ensureConfigDir, writeFileAtomic } from './config.js';

export const CREDENTIALS_VERSION = 1;

export interface StoredProfileBase {
  token: string;
  tokenPrefix: string;
  apiUrl?: string;
  label?: string;
  createdAt?: string;
}

export interface TokenProfile extends StoredProfileBase {
  type: 'token';
}

export interface OAuthProfile extends StoredProfileBase {
  type: 'oauth';
  refreshToken: string;
  expiresAt: string;
  authkitDomain: string;
}

export type StoredProfile = TokenProfile | OAuthProfile;

export interface CredentialsFile {
  version: number;
  current: string;
  profiles: Record<string, StoredProfile>;
}

export interface ProfileListEntry {
  name: string;
  current: boolean;
  profile: StoredProfile;
}

export function tokenPrefixOf(token: string): string {
  const value = token.trim();
  if (value === '') return '';
  const lastUnderscore = value.lastIndexOf('_');
  const start = lastUnderscore >= 0 ? lastUnderscore + 1 : 0;
  return value.slice(0, Math.min(value.length, start + 4));
}

export function redactToken(token: string | undefined): string {
  if (!token) return '…';
  const prefix = tokenPrefixOf(token);
  return prefix.length >= token.length ? prefix : `${prefix}…`;
}

function emptyCredentials(): CredentialsFile {
  return { version: CREDENTIALS_VERSION, current: 'default', profiles: {} };
}

export function credentialsExist(): boolean {
  return existsSync(credentialsPath());
}

export function credentialsMode(): number | undefined {
  const path = credentialsPath();
  if (!existsSync(path)) return undefined;
  return statSync(path).mode & 0o777;
}

export function assertCredentialsMode(): void {
  if (process.platform === 'win32') return;
  const mode = credentialsMode();
  if (mode === undefined) return;
  if ((mode & 0o077) === 0) return;
  const path = credentialsPath();
  throw new CliError(
    `${path} is readable by other users (mode ${mode.toString(8).padStart(4, '0')})`,
    {
      exitCode: ExitCode.AUTH,
      hint: `chmod 600 ${path}`,
    },
  );
}

function normalizeProfile(raw: unknown): StoredProfile | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const token = typeof record.token === 'string' ? record.token : undefined;
  if (!token) return undefined;
  const base: StoredProfileBase = {
    token,
    tokenPrefix: typeof record.tokenPrefix === 'string' ? record.tokenPrefix : tokenPrefixOf(token),
    ...(typeof record.apiUrl === 'string' ? { apiUrl: record.apiUrl } : {}),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
  };
  if (record.type === 'oauth') {
    return {
      ...base,
      type: 'oauth',
      refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : '',
      expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : '',
      authkitDomain: typeof record.authkitDomain === 'string' ? record.authkitDomain : '',
    };
  }
  return { ...base, type: 'token' };
}

export function readCredentials(): CredentialsFile {
  const path = credentialsPath();
  if (!existsSync(path)) return emptyCredentials();
  assertCredentialsMode();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CliError(`${path} is not valid JSON`, {
      exitCode: ExitCode.GENERIC,
      hint: `Fix the file, or start over with: rm ${path}`,
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyCredentials();
  const raw = parsed as Partial<CredentialsFile>;
  const profiles: Record<string, StoredProfile> = {};
  for (const [name, value] of Object.entries(raw.profiles ?? {})) {
    const profile = normalizeProfile(value);
    if (profile) profiles[name] = profile;
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : CREDENTIALS_VERSION,
    current: typeof raw.current === 'string' && raw.current !== '' ? raw.current : 'default',
    profiles,
  };
}

export function writeCredentials(credentials: CredentialsFile): void {
  ensureConfigDir();
  writeFileAtomic(credentialsPath(), `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
}

export function getProfile(name: string): StoredProfile | undefined {
  return readCredentials().profiles[name];
}

export function listProfiles(): ProfileListEntry[] {
  const credentials = readCredentials();
  return Object.entries(credentials.profiles).map(([name, profile]) => ({
    name,
    current: name === credentials.current,
    profile,
  }));
}

export function currentProfileName(): string {
  return readCredentials().current;
}

export function setCurrentProfile(name: string): void {
  const credentials = readCredentials();
  if (!credentials.profiles[name]) {
    throw new CliError(`No profile named "${name}"`, {
      exitCode: ExitCode.NOT_FOUND,
      hint: `Known profiles: ${Object.keys(credentials.profiles).join(', ') || 'none'}`,
    });
  }
  credentials.current = name;
  writeCredentials(credentials);
}

export interface SaveProfileInput {
  token: string;
  apiUrl?: string;
  label?: string;
  type?: 'token' | 'oauth';
  refreshToken?: string;
  expiresAt?: string;
  authkitDomain?: string;
}

export function saveProfile(
  name: string,
  input: SaveProfileInput,
  options: { makeCurrent?: boolean } = {},
): StoredProfile {
  const credentials = readCredentials();
  const existing = credentials.profiles[name];
  const base: StoredProfileBase = {
    token: input.token,
    tokenPrefix: tokenPrefixOf(input.token),
    ...(input.apiUrl ? { apiUrl: input.apiUrl } : existing?.apiUrl ? { apiUrl: existing.apiUrl } : {}),
    ...(input.label ? { label: input.label } : existing?.label ? { label: existing.label } : {}),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const profile: StoredProfile =
    input.type === 'oauth'
      ? {
          ...base,
          type: 'oauth',
          refreshToken: input.refreshToken ?? '',
          expiresAt: input.expiresAt ?? '',
          authkitDomain: input.authkitDomain ?? '',
        }
      : { ...base, type: 'token' };
  credentials.profiles[name] = profile;
  if (options.makeCurrent !== false) credentials.current = name;
  writeCredentials(credentials);
  return profile;
}

export function deleteProfile(name: string): boolean {
  const credentials = readCredentials();
  if (!credentials.profiles[name]) return false;
  delete credentials.profiles[name];
  if (credentials.current === name) {
    credentials.current = Object.keys(credentials.profiles)[0] ?? 'default';
  }
  writeCredentials(credentials);
  return true;
}

export function deleteAllProfiles(): number {
  const credentials = readCredentials();
  const count = Object.keys(credentials.profiles).length;
  writeCredentials(emptyCredentials());
  return count;
}
