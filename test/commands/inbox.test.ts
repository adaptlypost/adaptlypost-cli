import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboxComment, InboxConversation, InboxReview } from '../../src/api/types.js';

vi.mock('../../src/api/client.js', () => ({
  deleteInboxComment: vi.fn(),
  deleteInboxReviewReply: vi.fn(),
  getInboxComment: vi.fn(),
  getInboxConversation: vi.fn(),
  getInboxSummary: vi.fn(),
  hideInboxComment: vi.fn(),
  likeInboxComment: vi.fn(),
  listInboxComments: vi.fn(),
  listInboxConversations: vi.fn(),
  listInboxMentions: vi.fn(),
  listInboxReviews: vi.fn(),
  refreshInbox: vi.fn(),
  replyToInboxComment: vi.fn(),
  replyToInboxMention: vi.fn(),
  replyToInboxReview: vi.fn(),
  sendInboxMessage: vi.fn(),
  setInboxCommentsStatus: vi.fn(),
  setInboxConversationsStatus: vi.fn(),
  setInboxMentionsStatus: vi.fn(),
  setInboxReviewsStatus: vi.fn(),
  unhideInboxComment: vi.fn(),
  unlikeInboxComment: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { buildInboxReviewsQuery, registerInboxCommands, withInboxHint } = await import('../../src/commands/inbox.js');
const { ApiError } = await import('../../src/core/errors.js');
const { initOutput } = await import('../../src/core/output.js');
const { setInteractive } = await import('../../src/core/prompt.js');

const comment: InboxComment = {
  id: 'cm_1',
  accountId: 'ig_1',
  platform: 'INSTAGRAM',
  accountName: 'acme.bakery',
  postId: 'post_1',
  platformPostId: '1789',
  postText: 'New loaf',
  postPermalink: 'https://instagram.com/p/abc',
  platformCommentId: '1790',
  parentPlatformCommentId: null,
  isReply: false,
  author: { id: '55', name: 'Ada', username: 'ada', avatarUrl: null },
  text: 'Looks great',
  permalink: null,
  likeCount: 2,
  createdAt: '2026-11-01T10:00:00.000Z',
  status: 'UNREAD',
  isHidden: false,
  isOwn: false,
  replied: false,
  repliedAt: null,
  likedByAccount: false,
  capabilities: { canReply: true, canHide: true, canDelete: true, canLike: false },
};

const conversation: InboxConversation = {
  id: 'cv_1',
  accountId: 'fb_1',
  platform: 'FACEBOOK',
  accountName: 'Acme',
  participant: { id: '77', name: 'Bob', username: null, avatarUrl: null },
  lastMessageText: 'Are you open?',
  lastMessageAt: '2026-11-01T10:00:00.000Z',
  lastMessageIsOwn: false,
  status: 'UNREAD',
  repliedAt: null,
  replyWindowEndsAt: '2026-11-02T10:00:00.000Z',
  maxMessageLength: 2000,
  capabilities: { canReply: true },
};

const review: InboxReview = {
  id: 'rv_1',
  accountId: 'gbp_1',
  platform: 'GOOGLE_BUSINESS',
  accountName: 'Acme Bakery',
  platformReviewId: 'r1',
  reviewer: { name: 'Cy', avatarUrl: null, isAnonymous: false },
  rating: 5,
  text: 'Best bread',
  reply: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  status: 'UNREAD',
  repliedAt: null,
  maxReplyLength: 4096,
  capabilities: { canReply: true },
};

let written: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-y, --yes');
  registerInboxCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> => build().parseAsync(argv, { from: 'user' });

const stdoutJson = (): Record<string, unknown> => JSON.parse(written.join('')) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  written = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  initOutput({ json: true });
  setInteractive(false);
});

describe('the inbox command tree', () => {
  it('registers every channel and verb', () => {
    const inbox = build().commands.find((command) => command.name() === 'inbox');
    const verbs = (name: string): string[] =>
      inbox?.commands.find((command) => command.name() === name)?.commands.map((command) => command.name()) ?? [];

    expect(inbox?.commands.map((command) => command.name())).toEqual([
      'summary',
      'refresh',
      'comments',
      'mentions',
      'conversations',
      'reviews',
    ]);
    expect(verbs('comments')).toEqual(['list', 'get', 'reply', 'hide', 'unhide', 'like', 'unlike', 'delete', 'status']);
    expect(verbs('mentions')).toEqual(['list', 'reply', 'status']);
    expect(verbs('conversations')).toEqual(['list', 'get', 'send', 'status']);
    expect(verbs('reviews')).toEqual(['list', 'reply', 'delete-reply', 'status']);
  });
});

describe('inbox comments list', () => {
  it('sends every filter as the API names it', async () => {
    vi.mocked(client.listInboxComments).mockResolvedValue({
      comments: [comment],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

    await run([
      'inbox',
      'comments',
      'ls',
      '-a',
      'ig_1',
      '-a',
      'fb_1',
      '-P',
      'instagram',
      '--status',
      'unread',
      '--status',
      'READ',
      '--since',
      '2026-11-01T00:00:00Z',
      '--search',
      'price',
      '--post',
      'post_1',
      '--platform-post',
      '1789',
      '--limit',
      '10',
      '--cursor',
      'abc',
    ]);

    expect(client.listInboxComments).toHaveBeenCalledWith({
      accountIds: ['ig_1', 'fb_1'],
      platforms: ['INSTAGRAM'],
      statuses: ['UNREAD', 'READ'],
      since: '2026-11-01T00:00:00.000Z',
      search: 'price',
      postId: 'post_1',
      platformPostId: '1789',
      cursor: 'abc',
      limit: 10,
    });
    expect(stdoutJson()).toMatchObject({
      command: 'inbox.comments.list',
      data: [{ id: 'cm_1' }],
      meta: { total: 1, limit: 10, hasMore: false, nextCursor: null },
    });
  });

  it('follows nextCursor with --all', async () => {
    vi.mocked(client.listInboxComments)
      .mockResolvedValueOnce({ comments: [comment], total: 2, hasMore: true, nextCursor: 'page2' })
      .mockResolvedValueOnce({ comments: [{ ...comment, id: 'cm_2' }], total: 2, hasMore: false, nextCursor: null });

    await run(['inbox', 'comments', 'list', '--all']);

    expect(client.listInboxComments).toHaveBeenNthCalledWith(1, { limit: 100, cursor: undefined });
    expect(client.listInboxComments).toHaveBeenNthCalledWith(2, { limit: 100, cursor: 'page2' });
    expect(stdoutJson()).toMatchObject({ data: [{ id: 'cm_1' }, { id: 'cm_2' }], meta: { hasMore: false } });
  });

  it('refuses a bad status, limit or date before sending', async () => {
    await expect(run(['inbox', 'comments', 'list', '--status', 'ARCHIVED'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['inbox', 'comments', 'list', '--limit', '101'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['inbox', 'comments', 'list', '--since', 'last tuesday'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.listInboxComments).not.toHaveBeenCalled();
  });
});

describe('inbox comment actions', () => {
  it('replies with the text', async () => {
    vi.mocked(client.replyToInboxComment).mockResolvedValue({ ...comment, id: 'cm_9', isOwn: true });

    await run(['inbox', 'comments', 'reply', 'cm_1', '-t', '  Thank you!  ']);

    expect(client.replyToInboxComment).toHaveBeenCalledWith('cm_1', { text: 'Thank you!' });
    expect(stdoutJson()).toMatchObject({ command: 'inbox.comments.reply', data: { id: 'cm_9' } });
  });

  it('refuses a reply without text', async () => {
    await expect(run(['inbox', 'comments', 'reply', 'cm_1'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.replyToInboxComment).not.toHaveBeenCalled();
  });

  it.each([
    ['hide', 'hideInboxComment'],
    ['unhide', 'unhideInboxComment'],
    ['like', 'likeInboxComment'],
    ['unlike', 'unlikeInboxComment'],
  ] as const)('%s calls its endpoint', async (verb, method) => {
    vi.mocked(client[method]).mockResolvedValue(comment);

    await run(['inbox', 'comments', verb, 'cm_1']);

    expect(client[method]).toHaveBeenCalledWith('cm_1');
    expect(stdoutJson()).toMatchObject({ command: `inbox.comments.${verb}` });
  });

  it('deletes under --yes and asks first otherwise', async () => {
    vi.mocked(client.deleteInboxComment).mockResolvedValue({ deleted: true });

    await expect(run(['inbox', 'comments', 'delete', 'cm_1'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.deleteInboxComment).not.toHaveBeenCalled();

    await run(['inbox', 'comments', 'rm', 'cm_1', '--yes']);
    expect(client.deleteInboxComment).toHaveBeenCalledWith('cm_1');
  });

  it('sets the status of several comments at once', async () => {
    vi.mocked(client.setInboxCommentsStatus).mockResolvedValue({ comments: [comment], unreadCount: 0 });

    await run(['inbox', 'comments', 'status', 'cm_1', 'cm_2', 'cm_1', '--to', 'done']);

    expect(client.setInboxCommentsStatus).toHaveBeenCalledWith({ ids: ['cm_1', 'cm_2'], status: 'DONE' });
  });

  it('refuses a status change without --to or with more than 100 ids', async () => {
    await expect(run(['inbox', 'comments', 'status', 'cm_1'])).rejects.toMatchObject({ exitCode: 2 });
    const ids = Array.from({ length: 101 }, (_value, index) => `cm_${index}`);
    await expect(run(['inbox', 'comments', 'status', ...ids, '--to', 'READ'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.setInboxCommentsStatus).not.toHaveBeenCalled();
  });
});

describe('inbox mentions, conversations and reviews', () => {
  it('replies to a mention', async () => {
    vi.mocked(client.replyToInboxMention).mockResolvedValue({
      id: 'mn_1',
      accountId: 'bs_1',
      platform: 'BLUESKY',
      accountName: 'acme.bsky.social',
      platformMentionId: 'at://x',
      author: { id: 'did:1', name: 'Dee', username: 'dee.bsky.social', avatarUrl: null },
      text: '@acme hi',
      permalink: null,
      thumbnailUrl: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      status: 'READ',
      replied: true,
      repliedAt: '2026-11-01T11:00:00.000Z',
      capabilities: { canReply: true },
      replies: [{ id: 'r1', text: 'Hello', permalink: null, createdAt: '2026-11-01T11:00:00.000Z' }],
    });

    await run(['inbox', 'mentions', 'reply', 'mn_1', '--text', 'Hello']);

    expect(client.replyToInboxMention).toHaveBeenCalledWith('mn_1', { text: 'Hello' });
  });

  it('lists conversations and sends a message', async () => {
    vi.mocked(client.listInboxConversations).mockResolvedValue({
      conversations: [conversation],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });
    vi.mocked(client.sendInboxMessage).mockResolvedValue({
      conversation,
      message: { id: 'msg_1', isOwn: true, text: 'Yes, until 6', hasAttachments: false, createdAt: '2026-11-01T10:05:00.000Z' },
    });

    await run(['inbox', 'dm', 'list', '-P', 'FACEBOOK']);
    expect(client.listInboxConversations).toHaveBeenCalledWith({ platforms: ['FACEBOOK'], limit: 25 });

    written = [];
    await run(['inbox', 'conversations', 'send', 'cv_1', '-t', 'Yes, until 6']);
    expect(client.sendInboxMessage).toHaveBeenCalledWith('cv_1', { text: 'Yes, until 6' });
    expect(stdoutJson()).toMatchObject({ command: 'inbox.conversations.send', data: { message: { id: 'msg_1' } } });
  });

  it('filters reviews by rating and reply state', async () => {
    vi.mocked(client.listInboxReviews).mockResolvedValue({ reviews: [review], total: 1, hasMore: false, nextCursor: null });

    await run(['inbox', 'reviews', 'list', '--rating', '2', '--rating', '1', '--unreplied']);

    expect(client.listInboxReviews).toHaveBeenCalledWith({ ratings: [1, 2], replied: false, limit: 25 });
  });

  it('refuses a rating outside 1 to 5 and both reply filters', async () => {
    await expect(run(['inbox', 'reviews', 'list', '--rating', '6'])).rejects.toMatchObject({ exitCode: 2 });
    expect(() =>
      buildInboxReviewsQuery({ account: [], platform: [], status: [], rating: [], replied: true, unreplied: true }),
    ).toThrow(/not both/);
  });

  it('puts a review reply and deletes it under --yes', async () => {
    vi.mocked(client.replyToInboxReview).mockResolvedValue({
      ...review,
      reply: { text: 'Thanks', updatedAt: '2026-11-01T12:00:00.000Z' },
    });
    vi.mocked(client.deleteInboxReviewReply).mockResolvedValue(review);

    await run(['inbox', 'reviews', 'reply', 'rv_1', '-t', 'Thanks']);
    expect(client.replyToInboxReview).toHaveBeenCalledWith('rv_1', { text: 'Thanks' });

    await run(['inbox', 'reviews', 'delete-reply', 'rv_1', '--yes']);
    expect(client.deleteInboxReviewReply).toHaveBeenCalledWith('rv_1');
  });
});

describe('inbox refusals', () => {
  it('adds what to do next to each inbox code', () => {
    const refused = withInboxHint(
      new ApiError({
        status: 403,
        body: { statusCode: 403, code: 'inbox_reconnect_required', message: 'Reconnect the Instagram account' },
      }),
    ) as InstanceType<typeof ApiError>;

    expect(refused.code).toBe('inbox_reconnect_required');
    expect(refused.message).toBe('Reconnect the Instagram account');
    expect(refused.hint).toMatch(/Reconnect it on the Connectors page/);
  });

  it('passes the refusal through the command with its hint', async () => {
    vi.mocked(client.sendInboxMessage).mockRejectedValue(
      new ApiError({
        status: 400,
        body: { statusCode: 400, code: 'inbox_messaging_window_closed', message: 'The 24-hour window has passed' },
      }),
    );

    await expect(run(['inbox', 'conversations', 'send', 'cv_1', '-t', 'Hi'])).rejects.toMatchObject({
      code: 'inbox_messaging_window_closed',
      exitCode: 5,
      hint: expect.stringMatching(/24 hours/),
    });
  });

  it('leaves other errors alone', () => {
    const other = new ApiError({ status: 403, body: { code: 'permission_denied', message: 'No' } });
    expect(withInboxHint(other)).toBe(other);
  });
});
