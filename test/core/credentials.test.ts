import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir, credentialsPath, ensureConfigDir } from '../../src/core/config.js';
import {
  deleteAllProfiles,
  deleteProfile,
  listProfiles,
  readCredentials,
  redactToken,
  saveProfile,
  setCurrentProfile,
  tokenPrefixOf,
  writeCredentials,
} from '../../src/core/credentials.js';

let home: string;
let previousXdg: string | undefined;

beforeEach(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  home = mkdtempSync(join(tmpdir(), 'apost-creds-'));
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(home, { recursive: true, force: true });
});

describe('token formatting', () => {
  it('keeps the prefix plus four characters', () => {
    expect(tokenPrefixOf('adaptly_9f3a1b2c3d')).toBe('adaptly_9f3a');
    expect(tokenPrefixOf('flow_ws_9f3a1b2c')).toBe('flow_ws_9f3a');
    expect(redactToken('adaptly_ab12cd34')).toBe('adaptly_ab12…');
    expect(redactToken(undefined)).toBe('…');
  });
});

describe('credentials file', () => {
  it('starts empty when nothing is stored', () => {
    const credentials = readCredentials();
    expect(credentials).toEqual({ version: 1, current: 'default', profiles: {} });
  });

  it('writes 0600 through a temp file and leaves nothing behind', () => {
    saveProfile('default', { token: 'adaptly_9f3a1b2c', apiUrl: 'https://example.test/api/v1', label: 'personal' });

    const path = credentialsPath();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(configDir()).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored.current).toBe('default');
    expect(stored.profiles.default.type).toBe('token');
    expect(stored.profiles.default.tokenPrefix).toBe('adaptly_9f3a');
    expect(stored.profiles.default.createdAt).toEqual(expect.any(String));
  });

  it('refuses a group- or world-readable file and says how to fix it', () => {
    saveProfile('default', { token: 'adaptly_9f3a1b2c' });
    chmodSync(credentialsPath(), 0o644);

    try {
      readCredentials();
      expect.unreachable('readCredentials should have thrown');
    } catch (error) {
      const failure = error as Error & { exitCode?: number; hint?: string };
      expect(failure.message).toContain('readable by other users');
      expect(failure.hint).toContain(`chmod 600 ${credentialsPath()}`);
      expect(failure.exitCode).toBe(3);
    }
  });

  it('keeps several profiles and tracks the current one', () => {
    saveProfile('default', { token: 'adaptly_1111aaaa' });
    saveProfile('acme', { token: 'adaptly_2222bbbb', label: 'Acme workspace' });

    expect(readCredentials().current).toBe('acme');
    setCurrentProfile('default');
    expect(readCredentials().current).toBe('default');

    expect(listProfiles().map((entry) => entry.name).sort()).toEqual(['acme', 'default']);

    expect(deleteProfile('default')).toBe(true);
    expect(readCredentials().current).toBe('acme');
    expect(deleteProfile('missing')).toBe(false);

    expect(deleteAllProfiles()).toBe(1);
    expect(readCredentials().profiles).toEqual({});
  });

  it('does not make a saved profile current when asked not to', () => {
    saveProfile('default', { token: 'adaptly_1111aaaa' });
    saveProfile('ci', { token: 'adaptly_3333cccc' }, { makeCurrent: false });
    expect(readCredentials().current).toBe('default');
  });

  it('reads a file written before the type discriminator existed', () => {
    ensureConfigDir();
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ version: 1, current: 'default', profiles: { default: { token: 'adaptly_4444dddd' } } }),
      { mode: 0o600 },
    );
    const profile = readCredentials().profiles.default;
    expect(profile.type).toBe('token');
    expect(profile.tokenPrefix).toBe('adaptly_4444');
  });

  it('round-trips an oauth profile', () => {
    writeCredentials({
      version: 1,
      current: 'default',
      profiles: {
        default: {
          type: 'oauth',
          token: 'header.payload.signature',
          tokenPrefix: 'head',
          refreshToken: 'refresh',
          expiresAt: '2026-09-18T09:12:04Z',
          authkitDomain: 'auth.adaptlypost.com',
        },
      },
    });
    const profile = readCredentials().profiles.default;
    expect(profile.type).toBe('oauth');
    expect(profile.type === 'oauth' && profile.refreshToken).toBe('refresh');
  });
});
