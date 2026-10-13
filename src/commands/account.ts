import type { Command } from 'commander';

import {
  checkSocialAccount,
  listPinterestBoards,
  listSocialAccounts,
  searchInstagramAudio,
} from '../api/client.js';
import {
  INSTAGRAM_AUDIO_SEARCH_MAX_LENGTH,
  INSTAGRAM_AUDIO_TYPES,
  PLATFORM_TYPES,
  SOCIAL_ACCOUNT_STATUSES,
  type InstagramAudio,
  type InstagramAudioType,
  type PinterestBoard,
  type PlatformType,
  type SocialAccount,
  type SocialAccountCheck,
  type SocialAccountStatus,
} from '../api/types.js';
import {
  formatId,
  hint,
  isMachine,
  isQuiet,
  notFoundError,
  print,
  printKeyValues,
  printResult,
  printTable,
  spinner,
  usageError,
  yellow,
  type Column,
} from '../core/index.js';

export interface AccountListOptions {
  platform?: PlatformType[];
  status?: SocialAccountStatus;
}

export const normalizePlatform = (value: string): PlatformType => {
  const platform = value.trim().toUpperCase();
  if (!(PLATFORM_TYPES as readonly string[]).includes(platform)) {
    throw usageError(
      `Unknown platform "${value}"`,
      `valid platforms: ${PLATFORM_TYPES.join(', ')}`,
    );
  }
  return platform as PlatformType;
};

export const normalizeAccountStatus = (value: string): SocialAccountStatus => {
  const status = value.trim().toLowerCase();
  if (!(SOCIAL_ACCOUNT_STATUSES as readonly string[]).includes(status)) {
    throw usageError(
      `Unknown status "${value}"`,
      `valid statuses: ${SOCIAL_ACCOUNT_STATUSES.join(', ')}`,
    );
  }
  return status as SocialAccountStatus;
};

export const collectPlatform = (value: string, previous: PlatformType[] = []): PlatformType[] => [
  ...previous,
  normalizePlatform(value),
];

export const needsReauthorisation = (account: SocialAccount): boolean =>
  account.status === 'unauthorized';

export const accountHandle = (account: SocialAccount): string => {
  if (!account.username) return '—';
  return account.username.startsWith('@') ? account.username : `@${account.username}`;
};

export const accountNote = (account: SocialAccount): string => {
  if (needsReauthorisation(account)) {
    return account.unauthorizedReason ?? 'needs reconnecting';
  }
  if (account.pageId) return `page ${formatId(account.pageId)}`;
  return '—';
};

export const filterAccounts = (
  accounts: readonly SocialAccount[],
  filters: AccountListOptions,
): SocialAccount[] =>
  accounts.filter((account) => {
    if (filters.platform && filters.platform.length > 0 && !filters.platform.includes(account.platform)) {
      return false;
    }
    if (filters.status && account.status !== filters.status) return false;
    return true;
  });

export const findAccount = (
  accounts: readonly SocialAccount[],
  id: string,
): SocialAccount | undefined =>
  accounts.find((account) => account.id === id || account.pageId === id);

const fetchAccounts = async (label: string): Promise<SocialAccount[]> => {
  const progress = isQuiet() || isMachine() ? null : spinner(label);
  try {
    const { accounts } = await listSocialAccounts();
    return accounts;
  } finally {
    progress?.stop();
  }
};

export const normalizeAudioType = (value: string): InstagramAudioType => {
  const audioType = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!(INSTAGRAM_AUDIO_TYPES as readonly string[]).includes(audioType)) {
    throw usageError(
      `Unknown audio type "${value}"`,
      `valid types: ${INSTAGRAM_AUDIO_TYPES.join(', ')}`,
    );
  }
  return audioType as InstagramAudioType;
};

export const formatAudioLength = (durationMs: number | undefined): string => {
  if (durationMs === undefined || durationMs === null) return '—';
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export const audioArtist = (audio: InstagramAudio): string => {
  if (audio.displayArtist) return audio.displayArtist;
  if (audio.igUsername) return audio.igUsername.startsWith('@') ? audio.igUsername : `@${audio.igUsername}`;
  return '—';
};

const LIST_COLUMNS: Column<SocialAccount>[] = [
  { header: 'ID', value: (account) => formatId(account.id) },
  { header: 'PLATFORM', value: (account) => account.platform },
  { header: 'NAME', value: (account) => account.displayName || '—' },
  { header: 'HANDLE', value: (account) => accountHandle(account) },
  {
    header: 'STATUS',
    value: (account) =>
      needsReauthorisation(account) ? yellow(`! ${account.status}`) : account.status,
  },
  { header: 'NOTE', value: (account) => accountNote(account) },
];

const runList = async (options: AccountListOptions): Promise<void> => {
  const accounts = filterAccounts(await fetchAccounts('Loading accounts…'), options);

  if (isMachine()) {
    printResult('accounts.list', accounts, { total: accounts.length, hasMore: false });
    return;
  }

  if (accounts.length === 0) {
    print('No connected accounts match.');
    hint('connect one: adaptlypost connect create');
    return;
  }

  printTable(accounts, LIST_COLUMNS);

  const broken = accounts.filter(needsReauthorisation);
  const noun = accounts.length === 1 ? 'account' : 'accounts';

  print();
  print(
    broken.length > 0
      ? `${accounts.length} ${noun} · ${broken.length} needs reconnecting`
      : `${accounts.length} ${noun}`,
  );

  if (broken.length > 0) {
    hint('reconnect: adaptlypost open accounts');
  }
};

const runView = async (id: string): Promise<void> => {
  const account = findAccount(await fetchAccounts('Loading account…'), id);

  if (!account) {
    throw notFoundError(
      `No account with id "${id}" in this workspace`,
      'list them with: adaptlypost accounts list',
    );
  }

  if (isMachine()) {
    printResult('accounts.view', account);
    return;
  }

  print(account.id);
  print();

  const entries: Array<[string, string]> = [
    ['platform', account.platform],
    ['name', account.displayName || '—'],
    ['handle', accountHandle(account)],
    ['status', account.status],
  ];

  if (account.pageId) entries.push(['page', account.pageId]);
  if (account.platform === 'INSTAGRAM' && account.supportsInstagramAudio !== undefined) {
    entries.push([
      'reel audio',
      account.supportsInstagramAudio ? 'yes' : 'no, reconnect the account through Facebook to add audio',
    ]);
  }
  if (account.unauthorizedReason) entries.push(['reason', account.unauthorizedReason]);
  if (account.avatarUrl) entries.push(['avatar', account.avatarUrl]);

  printKeyValues(entries);

  if (needsReauthorisation(account)) {
    print();
    print(yellow('! This account cannot publish until it is reconnected.'));
    hint('reconnect: adaptlypost open accounts');
  }
};

const runCheck = async (id: string): Promise<void> => {
  const account = findAccount(await fetchAccounts('Loading account…'), id);

  if (!account) {
    throw notFoundError(
      `No account with id "${id}" in this workspace`,
      'list them with: adaptlypost accounts list',
    );
  }

  if (account.platform !== 'FACEBOOK') {
    throw usageError(
      `${account.platform} accounts cannot be re-checked`,
      'only Facebook pages expose a token check',
    );
  }

  const progress = isQuiet() || isMachine() ? null : spinner('Asking Facebook…');
  let checked: SocialAccountCheck;
  try {
    checked = await checkSocialAccount(account.id);
  } finally {
    progress?.stop();
  }

  if (isMachine()) {
    printResult('accounts.check', checked);
    return;
  }

  const entries: Array<[string, string]> = [
    ['name', checked.displayName || '—'],
    ['status', checked.status],
    ['checked', checked.checkedAt],
  ];
  if (checked.unauthorizedReason) entries.push(['reason', checked.unauthorizedReason]);

  print(checked.id);
  print();
  printKeyValues(entries);
  print();

  if (checked.status === 'unauthorized') {
    print(yellow('! Facebook still rejects this token.'));
    hint('reconnect: adaptlypost open accounts');
  } else {
    print('Facebook accepts this token; the page can publish.');
  }
};

interface InstagramAudioOptions {
  type: InstagramAudioType;
  search?: string;
}

const AUDIO_COLUMNS: Column<InstagramAudio>[] = [
  { header: 'AUDIO ID', value: (audio) => audio.audioId },
  { header: 'TYPE', value: (audio) => (audio.audioType === 'original_sound' ? 'original sound' : audio.audioType) },
  { header: 'TITLE', value: (audio) => audio.title || '—' },
  { header: 'ARTIST', value: audioArtist },
  { header: 'LENGTH', value: (audio) => formatAudioLength(audio.durationMs), align: 'right' },
];

const runInstagramAudio = async (id: string, options: InstagramAudioOptions): Promise<void> => {
  const searchQuery = options.search?.trim() || undefined;
  if (searchQuery && searchQuery.length > INSTAGRAM_AUDIO_SEARCH_MAX_LENGTH) {
    throw usageError(`--search is ${searchQuery.length} characters; the limit is ${INSTAGRAM_AUDIO_SEARCH_MAX_LENGTH}`);
  }

  const account = findAccount(await fetchAccounts('Loading account…'), id);

  if (!account) {
    throw notFoundError(
      `No account with id "${id}" in this workspace`,
      'list them with: adaptlypost accounts list --platform INSTAGRAM',
    );
  }

  if (account.platform !== 'INSTAGRAM') {
    throw usageError(`${account.platform} accounts have no Instagram audio`, 'pass an INSTAGRAM account id');
  }

  if (account.supportsInstagramAudio === false) {
    throw usageError(
      'This Instagram account cannot add audio to reels',
      'Meta only allows it for accounts connected through Facebook; reconnect it that way in AdaptlyPost',
    );
  }

  const progress = isQuiet() || isMachine() ? null : spinner('Asking Instagram…');
  let audio: InstagramAudio[];
  try {
    ({ audio } = await searchInstagramAudio(account.id, { audioType: options.type, searchQuery }));
  } finally {
    progress?.stop();
  }

  if (isMachine()) {
    printResult('accounts.instagram-audio', audio, { total: audio.length, hasMore: false });
    return;
  }

  if (audio.length === 0) {
    print(searchQuery ? `No ${options.type.replace('_', ' ')} matches "${searchQuery}".` : 'Nothing trending right now.');
    return;
  }

  printTable(audio, AUDIO_COLUMNS);
  print();
  print(`${audio.length} ${searchQuery ? `results for "${searchQuery}"` : 'trending'}`);
  hint('add one to a reel: adaptlypost post create --ig-type REEL --ig-audio <audioId> …');
};

const BOARD_COLUMNS: Column<PinterestBoard>[] = [
  { header: 'BOARD ID', value: (board) => board.id, align: 'left' },
  { header: 'NAME', value: (board) => board.name || '—' },
  { header: 'PRIVACY', value: (board) => board.privacy?.toLowerCase() ?? '—' },
  { header: 'PINS', value: (board) => board.pinCount ?? '—', align: 'right' },
];

const runPinterestBoards = async (id: string): Promise<void> => {
  const account = findAccount(await fetchAccounts('Loading account…'), id);

  if (!account) {
    throw notFoundError(
      `No account with id "${id}" in this workspace`,
      'list them with: adaptlypost accounts list --platform PINTEREST',
    );
  }

  if (account.platform !== 'PINTEREST') {
    throw usageError(`${account.platform} accounts have no Pinterest boards`, 'pass a PINTEREST account id');
  }

  const progress = isQuiet() || isMachine() ? null : spinner('Asking Pinterest…');
  let boards: PinterestBoard[];
  try {
    ({ boards } = await listPinterestBoards(account.id));
  } finally {
    progress?.stop();
  }

  if (isMachine()) {
    printResult('accounts.pinterest-boards', boards, { total: boards.length, hasMore: false });
    return;
  }

  if (boards.length === 0) {
    print('This Pinterest account has no boards.');
    hint('a post without --pinterest-board creates a public board named AdaptlyPost and pins to it');
    return;
  }

  printTable(boards, BOARD_COLUMNS);
  print();
  print(`${boards.length} ${boards.length === 1 ? 'board' : 'boards'}`);
  hint('pin to one: adaptlypost post create --pinterest-board <boardId> …');
};

export const registerAccountCommands = (program: Command): void => {
  const accounts = program
    .command('accounts')
    .alias('account')
    .description('connected social accounts');

  accounts
    .command('list')
    .alias('ls')
    .description('list the connected social accounts')
    .option(
      '--platform <platform>',
      `filter by platform, repeatable: ${PLATFORM_TYPES.join(', ')}`,
      collectPlatform,
      [] as PlatformType[],
    )
    .option(
      '--status <status>',
      `filter by status: ${SOCIAL_ACCOUNT_STATUSES.join(', ')}`,
      normalizeAccountStatus,
    )
    .action(async (options: AccountListOptions) => {
      await runList(options);
    });

  accounts
    .command('view <id>')
    .alias('get')
    .description('show one account by its id or Facebook page id')
    .action(async (id: string) => {
      await runView(id);
    });

  accounts
    .command('check <id>')
    .description('ask Facebook whether a page token still works (Facebook pages only)')
    .action(async (id: string) => {
      await runCheck(id);
    });

  accounts
    .command('instagram-audio <id>')
    .alias('ig-audio')
    .description(
      'search the music and original sounds an Instagram account can add to a reel; trending audio without --search',
    )
    .option('--type <type>', `${INSTAGRAM_AUDIO_TYPES.join(' or ')}`, normalizeAudioType, 'music' as InstagramAudioType)
    .option('--search <query>', `keyword filter, up to ${INSTAGRAM_AUDIO_SEARCH_MAX_LENGTH} characters`)
    .action(async (id: string, options: InstagramAudioOptions) => {
      await runInstagramAudio(id, options);
    });

  accounts
    .command('pinterest-boards <id>')
    .description('list the boards a Pinterest account can pin to, secret boards included')
    .action(async (id: string) => {
      await runPinterestBoards(id);
    });
};
