import type { Command } from 'commander';

import {
  deleteInboxComment,
  deleteInboxReviewReply,
  getInboxComment,
  getInboxConversation,
  getInboxSummary,
  hideInboxComment,
  likeInboxComment,
  listInboxComments,
  listInboxConversations,
  listInboxMentions,
  listInboxReviews,
  refreshInbox,
  replyToInboxComment,
  replyToInboxMention,
  replyToInboxReview,
  sendInboxMessage,
  setInboxCommentsStatus,
  setInboxConversationsStatus,
  setInboxMentionsStatus,
  setInboxReviewsStatus,
  unhideInboxComment,
  unlikeInboxComment,
} from '../api/client.js';
import {
  INBOX_LIST_DEFAULT_LIMIT,
  INBOX_LIST_MAX_ACCOUNTS,
  INBOX_LIST_MAX_LIMIT,
  INBOX_STATUSES,
  INBOX_STATUS_MAX_IDS,
  type InboxChannelAccess,
  type InboxComment,
  type InboxCommentsQuery,
  type InboxConversation,
  type InboxListQuery,
  type InboxMention,
  type InboxPage,
  type InboxReview,
  type InboxReviewsQuery,
  type InboxStatus,
  type InboxSummaryAccount,
  type PlatformType,
} from '../api/types.js';
import {
  ApiError,
  CliError,
  ExitCode,
  MAX_PAGES,
  PRODUCT,
  formatId,
  formatRelative,
  hint,
  isApiError,
  isMachine,
  isQuiet,
  parseWhen,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  promptConfirm,
  success,
  usageError,
  validateLimit,
  warn,
  type Column,
} from '../core/index.js';
import { collectPlatform } from './account.js';
import { readSource } from './post-input.js';

export const INBOX_REFUSAL_HINTS: Record<string, string> = {
  inbox_item_not_found: `Nothing with that id is in this workspace's inbox. List items with "${PRODUCT.binName} inbox comments list" or the mentions, conversations or reviews list.`,
  inbox_action_unsupported: `The platform does not allow this on this item. "${PRODUCT.binName} inbox comments get <id>" shows what each comment allows under capabilities.`,
  inbox_reconnect_required: `The account lacks the permission for this channel or its login expired. Reconnect it on the Connectors page in ${PRODUCT.displayName}; retrying will not help.`,
  inbox_reply_invalid: 'Fix the text and send it again. The message above names the limit.',
  inbox_messaging_window_closed:
    'Facebook and Instagram only take a reply within 24 hours of the last message from the person. Wait until they write again.',
  inbox_rate_limited: 'The platform is rate limiting this account. Try again in a few minutes.',
  inbox_platform_error: 'The platform did not answer. Try again later.',
};

export function withInboxHint(error: unknown): unknown {
  if (!isApiError(error)) return error;
  const extra = INBOX_REFUSAL_HINTS[error.code];
  if (extra === undefined) return error;
  return new ApiError({
    status: error.status,
    body: error.body,
    requestId: error.requestId,
    code: error.code,
    method: error.method,
    path: error.path,
    hint: extra,
    cause: error,
  });
}

const inboxAction =
  <A extends unknown[]>(handler: (...args: A) => Promise<void>) =>
  async (...args: A): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      throw withInboxHint(error);
    }
  };

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export const normalizeInboxStatus = (value: string): InboxStatus => {
  const status = value.trim().toUpperCase();
  if (!(INBOX_STATUSES as readonly string[]).includes(status)) {
    throw usageError(`Unknown status "${value}".`, `Statuses: ${INBOX_STATUSES.join(', ')}`);
  }
  return status as InboxStatus;
};

const collectStatus = (value: string, previous: InboxStatus[]): InboxStatus[] => [
  ...previous,
  normalizeInboxStatus(value),
];

const collectRating = (value: string, previous: number[]): number[] => {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw usageError(`--rating must be a whole number from 1 to 5, got "${value}".`);
  }
  return [...previous, rating];
};

interface ListOptions {
  account: string[];
  platform: PlatformType[];
  status: InboxStatus[];
  since?: string;
  search?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  quiet?: boolean;
}

interface CommentListOptions extends ListOptions {
  post?: string;
  platformPost?: string;
}

interface ReviewListOptions extends ListOptions {
  rating: number[];
  replied?: boolean;
  unreplied?: boolean;
}

interface TextOptions {
  text?: string;
}

interface StatusOptions {
  to?: string;
}

interface ConfirmOptions {
  yes?: boolean;
}

export function buildInboxListQuery(options: ListOptions): InboxListQuery {
  const query: InboxListQuery = {};
  const accounts = [...new Set(options.account.map((id) => id.trim()).filter(Boolean))];
  if (accounts.length > INBOX_LIST_MAX_ACCOUNTS) {
    throw usageError(`Pass at most ${INBOX_LIST_MAX_ACCOUNTS} --account flags, got ${accounts.length}.`);
  }
  if (accounts.length > 0) query.accountIds = accounts;
  if (options.platform.length > 0) query.platforms = [...new Set(options.platform)];
  if (options.status.length > 0) query.statuses = [...new Set(options.status)];
  if (options.since !== undefined) {
    try {
      query.since = parseWhen(options.since).toISOString();
    } catch {
      throw usageError(
        `--since "${options.since}" is not a date.`,
        'Use an ISO 8601 date such as 2026-11-01, or an offset such as -7d',
      );
    }
  }
  if (options.search !== undefined && options.search.trim() !== '') query.search = options.search.trim();
  if (options.cursor !== undefined && options.cursor.trim() !== '') query.cursor = options.cursor.trim();
  return query;
}

export function buildInboxCommentsQuery(options: CommentListOptions): InboxCommentsQuery {
  const query: InboxCommentsQuery = buildInboxListQuery(options);
  if (options.post !== undefined) query.postId = options.post.trim();
  if (options.platformPost !== undefined) query.platformPostId = options.platformPost.trim();
  return query;
}

export function buildInboxReviewsQuery(options: ReviewListOptions): InboxReviewsQuery {
  if (options.replied && options.unreplied) throw usageError('Pass --replied or --unreplied, not both.');
  const query: InboxReviewsQuery = buildInboxListQuery(options);
  if (options.rating.length > 0) query.ratings = [...new Set(options.rating)].sort((left, right) => left - right);
  if (options.replied) query.replied = true;
  if (options.unreplied) query.replied = false;
  return query;
}

interface FetchedPage<T> extends InboxPage {
  items: T[];
}

interface CollectedPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  limit?: number;
}

export async function collectInboxPages<T>(
  options: Pick<ListOptions, 'limit' | 'all' | 'quiet'>,
  query: InboxListQuery,
  fetchPage: (query: InboxListQuery) => Promise<FetchedPage<T>>,
): Promise<CollectedPage<T>> {
  if (!options.all) {
    const limit =
      options.limit === undefined ? INBOX_LIST_DEFAULT_LIMIT : validateLimit(options.limit, 1, INBOX_LIST_MAX_LIMIT);
    const page = await fetchPage({ ...query, limit });
    return { items: page.items, total: page.total, hasMore: page.hasMore, nextCursor: page.nextCursor, limit };
  }

  const items: T[] = [];
  let cursor = query.cursor;
  let total = 0;
  let pages = 0;
  let nextCursor: string | null = null;

  do {
    const page = await fetchPage({ ...query, limit: INBOX_LIST_MAX_LIMIT, cursor });
    pages += 1;
    items.push(...page.items);
    total = page.total;
    nextCursor = page.nextCursor;
    cursor = nextCursor ?? undefined;
  } while (nextCursor !== null && pages < MAX_PAGES);

  if (nextCursor !== null && !(options.quiet || isQuiet())) {
    warn(`stopped after ${MAX_PAGES} requests (${items.length} items). Continue with --cursor ${nextCursor}`);
  }

  return { items, total, hasMore: nextCursor !== null, nextCursor };
}

const oneLine = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim() || '—';

const when = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatRelative(date);
};

const personOf = (person: { name: string; username?: string | null }): string =>
  person.username ? `${person.name} (@${person.username.replace(/^@/, '')})` : person.name;

const commentState = (comment: InboxComment): string =>
  [
    comment.status,
    comment.replied ? 'replied' : undefined,
    comment.isHidden ? 'hidden' : undefined,
    comment.isOwn ? 'own' : undefined,
    comment.likedByAccount ? 'liked' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

const COMMENT_COLUMNS: Column<InboxComment>[] = [
  { header: 'ID', value: (comment) => formatId(comment.id) },
  { header: 'PLATFORM', value: (comment) => comment.platform },
  { header: 'ACCOUNT', value: (comment) => comment.accountName },
  { header: 'FROM', value: (comment) => personOf(comment.author) },
  { header: 'STATE', value: commentState },
  { header: 'WHEN', value: (comment) => when(comment.createdAt) },
  { header: 'TEXT', value: (comment) => oneLine(comment.text) },
];

const MENTION_COLUMNS: Column<InboxMention>[] = [
  { header: 'ID', value: (mention) => formatId(mention.id) },
  { header: 'PLATFORM', value: (mention) => mention.platform },
  { header: 'ACCOUNT', value: (mention) => mention.accountName },
  { header: 'FROM', value: (mention) => personOf(mention.author) },
  { header: 'STATE', value: (mention) => (mention.replied ? `${mention.status} · replied` : mention.status) },
  { header: 'WHEN', value: (mention) => when(mention.createdAt) },
  { header: 'TEXT', value: (mention) => oneLine(mention.text) },
];

const CONVERSATION_COLUMNS: Column<InboxConversation>[] = [
  { header: 'ID', value: (conversation) => formatId(conversation.id) },
  { header: 'PLATFORM', value: (conversation) => conversation.platform },
  { header: 'ACCOUNT', value: (conversation) => conversation.accountName },
  { header: 'WITH', value: (conversation) => personOf(conversation.participant) },
  { header: 'STATUS', value: (conversation) => conversation.status },
  { header: 'LAST', value: (conversation) => when(conversation.lastMessageAt) },
  {
    header: 'LAST MESSAGE',
    value: (conversation) => `${conversation.lastMessageIsOwn ? 'you: ' : ''}${oneLine(conversation.lastMessageText)}`,
  },
];

const stars = (rating: number): string => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

const REVIEW_COLUMNS: Column<InboxReview>[] = [
  { header: 'ID', value: (review) => formatId(review.id) },
  { header: 'LOCATION', value: (review) => review.accountName },
  { header: 'RATING', value: (review) => stars(review.rating) },
  { header: 'FROM', value: (review) => (review.reviewer.isAnonymous ? 'anonymous' : review.reviewer.name) },
  { header: 'STATE', value: (review) => (review.reply ? `${review.status} · replied` : review.status) },
  { header: 'WHEN', value: (review) => when(review.createdAt) },
  { header: 'TEXT', value: (review) => oneLine(review.text) },
];

function printList<T>(command: string, noun: string, page: CollectedPage<T>, columns: Column<T>[]): void {
  if (isMachine()) {
    printResult(command, page.items, {
      total: page.total,
      limit: page.limit,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
    printFieldHints(page.items);
    return;
  }

  if (page.items.length === 0) {
    print(`No ${noun} match those filters.`);
    return;
  }

  printTable(page.items, columns);
  print();
  print(`${page.items.length} of ${page.total}`);
  if (page.nextCursor !== null) print(`next: --cursor ${page.nextCursor}`);
}

async function resolveText(options: TextOptions, example: string): Promise<string> {
  if (options.text === undefined) throw usageError('--text is required.', example);
  const text = options.text === '-' ? await readSource('-') : options.text;
  if (text.trim() === '') throw usageError('--text is empty.', example);
  return text.trim();
}

export async function resolveIds(ids: readonly string[]): Promise<string[]> {
  const raw = ids.length === 1 && ids[0] === '-' ? (await readSource('-')).split(/\r?\n/) : [...ids];
  const unique = [...new Set(raw.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) throw usageError('Pass at least one id, or - to read one id per line from stdin.');
  if (unique.length > INBOX_STATUS_MAX_IDS) {
    throw usageError(`Pass at most ${INBOX_STATUS_MAX_IDS} ids at once, got ${unique.length}.`);
  }
  return unique;
}

function statusOf(options: StatusOptions, noun: string): InboxStatus {
  if (options.to === undefined) {
    throw usageError('--to is required.', `inbox ${noun} status <ids...> --to DONE`);
  }
  return normalizeInboxStatus(options.to);
}

async function confirmOrCancel(message: string, options: ConfirmOptions): Promise<void> {
  if (options.yes) return;
  const proceed = await promptConfirm(message, { assumeYes: false });
  if (!proceed) throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
}

const ACCESS_LABEL: Record<InboxChannelAccess, string> = {
  AVAILABLE: 'yes',
  RECONNECT_REQUIRED: 'reconnect',
  UNSUPPORTED: '—',
};

const SUMMARY_COLUMNS: Column<InboxSummaryAccount>[] = [
  { header: 'ACCOUNT ID', value: (account) => formatId(account.accountId) },
  { header: 'PLATFORM', value: (account) => account.platform },
  { header: 'NAME', value: (account) => account.accountName },
  { header: 'COMMENTS', value: (account) => ACCESS_LABEL[account.comments] },
  { header: 'MENTIONS', value: (account) => ACCESS_LABEL[account.mentions] },
  { header: 'MESSAGES', value: (account) => ACCESS_LABEL[account.messages] },
  { header: 'REVIEWS', value: (account) => ACCESS_LABEL[account.reviews] },
  { header: 'LAST SYNC', value: (account) => when(account.lastSyncedAt) },
];

async function runSummary(): Promise<void> {
  const summary = await getInboxSummary();

  if (isMachine()) {
    printResult('inbox.summary', summary);
    return;
  }

  const { unread } = summary;
  print(
    `Unread: ${unread.comments} comments · ${unread.mentions} mentions · ${unread.conversations} conversations · ${unread.reviews} reviews`,
  );
  if (summary.accounts.length === 0) {
    print();
    print('No connected account has an inbox.');
    return;
  }
  print();
  printTable(summary.accounts, SUMMARY_COLUMNS);
  if (summary.accounts.some((account) => account.needsReconnect || hasReconnect(account))) {
    print();
    hint(`"reconnect" means the account lacks the permission for that channel. Reconnect it on the Connectors page in ${PRODUCT.displayName}.`);
  }
}

const hasReconnect = (account: InboxSummaryAccount): boolean =>
  [account.comments, account.mentions, account.messages, account.reviews].includes('RECONNECT_REQUIRED');

async function runRefresh(): Promise<void> {
  const result = await refreshInbox();
  if (isMachine()) {
    printResult('inbox.refresh', result);
    return;
  }
  success('Inbox sync queued');
  hint('New items show up within a few minutes.');
}

async function runCommentList(options: CommentListOptions): Promise<void> {
  const page = await collectInboxPages(options, buildInboxCommentsQuery(options), async (query) => {
    const response = await listInboxComments(query);
    return { ...response, items: response.comments };
  });
  printList('inbox.comments.list', 'comments', page, COMMENT_COLUMNS);
}

const commentDetails = (comment: InboxComment): [string, string][] => [
  ['id', comment.id],
  ['platform', `${comment.platform} · ${comment.accountName}`],
  ['from', personOf(comment.author)],
  ['state', commentState(comment)],
  ['when', when(comment.createdAt)],
  ['text', comment.text],
  ['link', comment.permalink ?? '—'],
  ['post', comment.postPermalink ?? comment.postId ?? comment.platformPostId],
  [
    'can',
    Object.entries(comment.capabilities)
      .filter(([, allowed]) => allowed)
      .map(([name]) => name.replace(/^can/, '').toLowerCase())
      .join(', ') || '—',
  ],
];

async function runCommentGet(id: string): Promise<void> {
  const thread = await getInboxComment(id);

  if (isMachine()) {
    printResult('inbox.comments.get', thread);
    return;
  }

  if (thread.parent) {
    print(`In reply to ${personOf(thread.parent.author)}: ${oneLine(thread.parent.text)}`);
    print();
  }
  printKeyValues(commentDetails(thread.comment), '');
  if (thread.replies.length > 0) {
    print();
    printTable(thread.replies, COMMENT_COLUMNS);
  }
}

async function runCommentReply(id: string, options: TextOptions): Promise<void> {
  const text = await resolveText(options, `inbox comments reply ${id} --text "Thanks!"`);
  const reply = await replyToInboxComment(id, { text });
  if (isMachine()) {
    printResult('inbox.comments.reply', reply);
    return;
  }
  success(`Reply posted  ${formatId(reply.id)}`);
  if (reply.permalink) print(reply.permalink);
}

const commentToggle =
  (command: string, call: (id: string) => Promise<InboxComment>, done: string) =>
  async (id: string): Promise<void> => {
    const comment = await call(id);
    if (isMachine()) {
      printResult(command, comment);
      return;
    }
    success(`${done}  ${formatId(comment.id)}`);
  };

async function runCommentDelete(id: string, options: ConfirmOptions): Promise<void> {
  await confirmOrCancel(`Delete comment ${formatId(id)} on the platform? This cannot be undone.`, options);
  const result = await deleteInboxComment(id);
  if (isMachine()) {
    printResult('inbox.comments.delete', result);
    return;
  }
  success('Deleted');
}

async function runCommentStatus(ids: string[], options: StatusOptions): Promise<void> {
  const status = statusOf(options, 'comments');
  const result = await setInboxCommentsStatus({ ids: await resolveIds(ids), status });
  if (isMachine()) {
    printResult('inbox.comments.status', result);
    return;
  }
  success(`${result.comments.length} marked ${status} · ${result.unreadCount} unread`);
}

async function runMentionList(options: ListOptions): Promise<void> {
  const page = await collectInboxPages(options, buildInboxListQuery(options), async (query) => {
    const response = await listInboxMentions(query);
    return { ...response, items: response.mentions };
  });
  printList('inbox.mentions.list', 'mentions', page, MENTION_COLUMNS);
}

async function runMentionReply(id: string, options: TextOptions): Promise<void> {
  const text = await resolveText(options, `inbox mentions reply ${id} --text "Thanks for the shout-out"`);
  const mention = await replyToInboxMention(id, { text });
  if (isMachine()) {
    printResult('inbox.mentions.reply', mention);
    return;
  }
  success(`Reply posted to mention ${formatId(mention.id)}`);
  const latest = mention.replies.at(-1);
  if (latest?.permalink) print(latest.permalink);
}

async function runMentionStatus(ids: string[], options: StatusOptions): Promise<void> {
  const status = statusOf(options, 'mentions');
  const result = await setInboxMentionsStatus({ ids: await resolveIds(ids), status });
  if (isMachine()) {
    printResult('inbox.mentions.status', result);
    return;
  }
  success(`${result.mentions.length} marked ${status} · ${result.unreadCount} unread`);
}

async function runConversationList(options: ListOptions): Promise<void> {
  const page = await collectInboxPages(options, buildInboxListQuery(options), async (query) => {
    const response = await listInboxConversations(query);
    return { ...response, items: response.conversations };
  });
  printList('inbox.conversations.list', 'conversations', page, CONVERSATION_COLUMNS);
}

async function runConversationGet(id: string): Promise<void> {
  const thread = await getInboxConversation(id);

  if (isMachine()) {
    printResult('inbox.conversations.get', thread);
    return;
  }

  const { conversation } = thread;
  printKeyValues(
    [
      ['id', conversation.id],
      ['platform', `${conversation.platform} · ${conversation.accountName}`],
      ['with', personOf(conversation.participant)],
      ['status', conversation.status],
      ['reply until', conversation.replyWindowEndsAt ? when(conversation.replyWindowEndsAt) : '—'],
      ['max length', String(conversation.maxMessageLength)],
    ],
    '',
  );
  print();
  if (thread.messages.length === 0) {
    print('No messages.');
    return;
  }
  for (const message of thread.messages) {
    const attachment = message.hasAttachments ? ' [attachment]' : '';
    print(`${message.isOwn ? 'you ' : 'them'}  ${when(message.createdAt)}  ${oneLine(message.text)}${attachment}`);
  }
}

async function runConversationSend(id: string, options: TextOptions): Promise<void> {
  const text = await resolveText(options, `inbox conversations send ${id} --text "Hi, thanks for writing"`);
  const sent = await sendInboxMessage(id, { text });
  if (isMachine()) {
    printResult('inbox.conversations.send', sent);
    return;
  }
  success(`Message sent  ${formatId(sent.message.id)}`);
}

async function runConversationStatus(ids: string[], options: StatusOptions): Promise<void> {
  const status = statusOf(options, 'conversations');
  const result = await setInboxConversationsStatus({ ids: await resolveIds(ids), status });
  if (isMachine()) {
    printResult('inbox.conversations.status', result);
    return;
  }
  success(`${result.conversations.length} marked ${status} · ${result.unreadCount} unread`);
}

async function runReviewList(options: ReviewListOptions): Promise<void> {
  const page = await collectInboxPages(options, buildInboxReviewsQuery(options), async (query) => {
    const response = await listInboxReviews(query);
    return { ...response, items: response.reviews };
  });
  printList('inbox.reviews.list', 'reviews', page, REVIEW_COLUMNS);
}

async function runReviewReply(id: string, options: TextOptions): Promise<void> {
  const text = await resolveText(options, `inbox reviews reply ${id} --text "Thank you for visiting"`);
  const review = await replyToInboxReview(id, { text });
  if (isMachine()) {
    printResult('inbox.reviews.reply', review);
    return;
  }
  success(`Reply saved on review ${formatId(review.id)}`);
}

async function runReviewDeleteReply(id: string, options: ConfirmOptions): Promise<void> {
  await confirmOrCancel(`Delete the reply on review ${formatId(id)} from Google?`, options);
  const review = await deleteInboxReviewReply(id);
  if (isMachine()) {
    printResult('inbox.reviews.delete-reply', review);
    return;
  }
  success('Reply deleted');
}

async function runReviewStatus(ids: string[], options: StatusOptions): Promise<void> {
  const status = statusOf(options, 'reviews');
  const result = await setInboxReviewsStatus({ ids: await resolveIds(ids), status });
  if (isMachine()) {
    printResult('inbox.reviews.status', result);
    return;
  }
  success(`${result.reviews.length} marked ${status} · ${result.unreadCount} unread`);
}

const withListFlags = (command: Command): Command =>
  command
    .option('-a, --account <id>', 'only these accounts, by the id from accounts list, repeatable', collect, [])
    .option('-P, --platform <platform>', 'only these platforms, repeatable', collectPlatform, [] as PlatformType[])
    .option('--status <status>', `only these statuses, repeatable: ${INBOX_STATUSES.join(', ')}`, collectStatus, [])
    .option('--since <date>', 'only items created on the platform at or after this time: ISO 8601 or an offset like -7d')
    .option('--search <text>', 'only items whose text matches')
    .option('--limit <n>', `items per page, 1..${INBOX_LIST_MAX_LIMIT} (default ${INBOX_LIST_DEFAULT_LIMIT})`)
    .option('--cursor <cursor>', 'start after this cursor, from the previous page')
    .option('--all', `follow every page, up to ${MAX_PAGES} requests`);

const withText = (command: Command): Command => command.option('-t, --text <text>', 'the text; - reads it from stdin');

const withStatusTarget = (command: Command): Command =>
  command.option('--to <status>', `new status: ${INBOX_STATUSES.join(', ')}`);

export function registerInboxCommands(program: Command): void {
  const inbox = program
    .command('inbox')
    .description('Comments, mentions, direct messages and Google reviews of the connected accounts');

  inbox
    .command('summary')
    .description('Unread counts and which channels each account can use')
    .action(inboxAction(runSummary));

  inbox
    .command('refresh')
    .description('Ask for an inbox sync now instead of waiting for the next one')
    .action(inboxAction(runRefresh));

  const comments = inbox.command('comments').alias('comment').description('Comments on the posts of the connected accounts');

  withListFlags(comments.command('list').alias('ls').description('List comments, newest first'))
    .option('--post <id>', 'only comments on this AdaptlyPost post')
    .option('--platform-post <id>', "only comments on this post, by the platform's own post id")
    .action(inboxAction(runCommentList));

  comments
    .command('get <id>')
    .alias('view')
    .description('One comment with the comment it answers and its replies')
    .action(inboxAction(runCommentGet));

  withText(comments.command('reply <id>').description('Reply to a comment from the account')).action(
    inboxAction(runCommentReply),
  );

  comments
    .command('hide <id>')
    .description('Hide a comment on the platform')
    .action(inboxAction(commentToggle('inbox.comments.hide', hideInboxComment, 'Hidden')));

  comments
    .command('unhide <id>')
    .description('Show a hidden comment again')
    .action(inboxAction(commentToggle('inbox.comments.unhide', unhideInboxComment, 'Shown')));

  comments
    .command('like <id>')
    .description('Like a comment from the account')
    .action(inboxAction(commentToggle('inbox.comments.like', likeInboxComment, 'Liked')));

  comments
    .command('unlike <id>')
    .description('Take the like off a comment')
    .action(inboxAction(commentToggle('inbox.comments.unlike', unlikeInboxComment, 'Unliked')));

  comments
    .command('delete <id>')
    .alias('rm')
    .description('Delete a comment on the platform')
    .action(
      inboxAction(async (id: string, _options: ConfirmOptions, command: Command) => {
        await runCommentDelete(id, command.optsWithGlobals() as ConfirmOptions);
      }),
    );

  withStatusTarget(
    comments.command('status <ids...>').description(`Set the status of up to ${INBOX_STATUS_MAX_IDS} comments; - reads ids from stdin`),
  ).action(inboxAction(runCommentStatus));

  const mentions = inbox.command('mentions').alias('mention').description('Posts that mention the connected accounts');

  withListFlags(mentions.command('list').alias('ls').description('List mentions, newest first')).action(
    inboxAction(runMentionList),
  );

  withText(mentions.command('reply <id>').description('Reply to a mention from the account')).action(
    inboxAction(runMentionReply),
  );

  withStatusTarget(
    mentions.command('status <ids...>').description(`Set the status of up to ${INBOX_STATUS_MAX_IDS} mentions; - reads ids from stdin`),
  ).action(inboxAction(runMentionStatus));

  const conversations = inbox
    .command('conversations')
    .alias('conversation')
    .alias('dm')
    .description('Direct message conversations');

  withListFlags(
    conversations.command('list').alias('ls').description('List conversations, latest message first'),
  ).action(inboxAction(runConversationList));

  conversations
    .command('get <id>')
    .alias('view')
    .description('One conversation with its messages')
    .action(inboxAction(runConversationGet));

  withText(conversations.command('send <id>').description('Send a message in a conversation')).action(
    inboxAction(runConversationSend),
  );

  withStatusTarget(
    conversations
      .command('status <ids...>')
      .description(`Set the status of up to ${INBOX_STATUS_MAX_IDS} conversations; - reads ids from stdin`),
  ).action(inboxAction(runConversationStatus));

  const reviews = inbox.command('reviews').alias('review').description('Google Business Profile reviews');

  withListFlags(reviews.command('list').alias('ls').description('List reviews, newest first'))
    .option('--rating <1-5>', 'only reviews with this star rating, repeatable', collectRating, [] as number[])
    .option('--replied', 'only reviews that have a reply')
    .option('--unreplied', 'only reviews without a reply')
    .action(inboxAction(runReviewList));

  withText(
    reviews.command('reply <id>').description('Reply to a review, replacing the reply already there'),
  ).action(inboxAction(runReviewReply));

  reviews
    .command('delete-reply <id>')
    .description('Delete the reply on a review')
    .action(
      inboxAction(async (id: string, _options: ConfirmOptions, command: Command) => {
        await runReviewDeleteReply(id, command.optsWithGlobals() as ConfirmOptions);
      }),
    );

  withStatusTarget(
    reviews.command('status <ids...>').description(`Set the status of up to ${INBOX_STATUS_MAX_IDS} reviews; - reads ids from stdin`),
  ).action(inboxAction(runReviewStatus));
}
