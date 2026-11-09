import { request } from '../core/http.js';
import type {
  AnalyticsBreakdownQuery,
  AnalyticsDiscoveredPostsQuery,
  AnalyticsOverview,
  AnalyticsPostsQuery,
  AnalyticsRangeQuery,
  AnalyticsSyncStatus,
  AnalyticsTimeseriesQuery,
  AnalyticsTimeseriesResponse,
  AnalyticsTopPostsQuery,
  BulkPostValidationReport,
  BulkSchedulePostsRequest,
  BulkSchedulePostsResponse,
  CaptionResponse,
  ConnectLink,
  CreateConnectLinkRequest,
  CreatePostRequest,
  CreatePostResponse,
  CreateUploadUrlsRequest,
  CreateWebhookRequest,
  CreatedWebhook,
  DeletedResponse,
  DiscoveredPostsResponse,
  GenerateCaptionRequest,
  GenerateImageRequest,
  GenerateImageResponse,
  ImageJob,
  InboxComment,
  InboxCommentThread,
  InboxCommentsQuery,
  InboxCommentsResponse,
  InboxCommentsStatusResponse,
  InboxConversationThread,
  InboxConversationsResponse,
  InboxConversationsStatusResponse,
  InboxListQuery,
  InboxMention,
  InboxMentionsResponse,
  InboxMentionsStatusResponse,
  InboxReview,
  InboxReviewsQuery,
  InboxReviewsResponse,
  InboxReviewsStatusResponse,
  InboxStatusRequest,
  InboxSummary,
  InboxTextRequest,
  SentInboxMessage,
  InstagramAudioResponse,
  LinkedInOrganizationLookupResponse,
  ListPostAnalyticsResponse,
  ListPostsQuery,
  ListPostsResponse,
  ListRecurringPostsQuery,
  ListRecurringPostsResponse,
  LookupLinkedInOrganizationQuery,
  Me,
  PinterestBoardsResponse,
  WordPressCategoriesResponse,
  PlatformBreakdownResponse,
  PostResultsResponse,
  PostValidationReport,
  PublishDraftRequest,
  PublishResponse,
  RecurringPost,
  RefineCaptionRequest,
  RetryFailedPlatformsRequest,
  RevokeConnectLinkResponse,
  SearchInstagramAudioQuery,
  SocialAccountCheck,
  SocialAccountRemoval,
  SocialAccountsResponse,
  SocialPost,
  TopPostsResponse,
  TriggerAnalyticsSyncResponse,
  UpdatePostRequest,
  UpdateWebhookRequest,
  UploadUrlsResponse,
  Webhook,
  WebhookTestResult,
  WebhooksResponse,
} from './types.js';

const segment = (value: string): string => encodeURIComponent(value);

export const getMe = (): Promise<Me> => request<Me>({ method: 'GET', path: '/me' });

export const listSocialAccounts = (): Promise<SocialAccountsResponse> =>
  request<SocialAccountsResponse>({ method: 'GET', path: '/social-accounts' });

export const checkSocialAccount = (
  accountId: string,
): Promise<SocialAccountCheck> =>
  request<SocialAccountCheck>({
    method: 'POST',
    path: `/social-accounts/${segment(accountId)}/check`,
    idempotent: true,
  });

export const removeSocialAccount = (
  accountId: string,
): Promise<SocialAccountRemoval> =>
  request<SocialAccountRemoval>({
    method: 'DELETE',
    path: `/social-accounts/${segment(accountId)}`,
  });

export const searchInstagramAudio = (
  accountId: string,
  searchInstagramAudioQuery: SearchInstagramAudioQuery,
): Promise<InstagramAudioResponse> =>
  request<InstagramAudioResponse>({
    method: 'GET',
    path: `/social-accounts/${segment(accountId)}/instagram-audio`,
    query: searchInstagramAudioQuery,
  });

export const listPinterestBoards = (
  accountId: string,
): Promise<PinterestBoardsResponse> =>
  request<PinterestBoardsResponse>({
    method: 'GET',
    path: `/social-accounts/${segment(accountId)}/pinterest-boards`,
  });

export const listWordPressCategories = (
  accountId: string,
): Promise<WordPressCategoriesResponse> =>
  request<WordPressCategoriesResponse>({
    method: 'GET',
    path: `/social-accounts/${segment(accountId)}/wordpress-categories`,
  });

export const lookupLinkedInOrganization = (
  lookupLinkedInOrganizationQuery: LookupLinkedInOrganizationQuery,
): Promise<LinkedInOrganizationLookupResponse> =>
  request<LinkedInOrganizationLookupResponse>({
    method: 'GET',
    path: '/linkedin-organizations/lookup',
    query: lookupLinkedInOrganizationQuery,
  });

export const createUploadUrls = (
  createUploadUrlsRequest: CreateUploadUrlsRequest,
): Promise<UploadUrlsResponse> =>
  request<UploadUrlsResponse>({
    method: 'POST',
    path: '/upload-urls',
    body: createUploadUrlsRequest,
  });

export const listPosts = (
  listPostsQuery: ListPostsQuery = {},
): Promise<ListPostsResponse> =>
  request<ListPostsResponse>({
    method: 'GET',
    path: '/social-posts',
    query: listPostsQuery,
  });

export const getPost = (postId: string): Promise<SocialPost> =>
  request<SocialPost>({
    method: 'GET',
    path: `/social-posts/${segment(postId)}`,
  });

export const createPost = (
  createPostRequest: CreatePostRequest,
): Promise<CreatePostResponse> =>
  request<CreatePostResponse>({
    method: 'POST',
    path: '/social-posts',
    body: createPostRequest,
  });

export const validatePost = (
  createPostRequest: CreatePostRequest,
): Promise<PostValidationReport> =>
  request<PostValidationReport>({
    method: 'POST',
    path: '/social-posts/validate',
    body: createPostRequest,
  });

export const updatePost = (
  postId: string,
  updatePostRequest: UpdatePostRequest,
): Promise<SocialPost> =>
  request<SocialPost>({
    method: 'PATCH',
    path: `/social-posts/${segment(postId)}`,
    body: updatePostRequest,
  });

export const deletePost = (postId: string): Promise<DeletedResponse> =>
  request<DeletedResponse>({
    method: 'DELETE',
    path: `/social-posts/${segment(postId)}`,
  });

export const unschedulePost = (postId: string): Promise<SocialPost> =>
  request<SocialPost>({
    method: 'POST',
    path: `/social-posts/${segment(postId)}/unschedule`,
  });

export const publishDraft = (
  postId: string,
  publishDraftRequest: PublishDraftRequest,
): Promise<PublishResponse> =>
  request<PublishResponse>({
    method: 'POST',
    path: `/social-posts/${segment(postId)}/publish`,
    body: publishDraftRequest,
  });

export const listPostResults = (postId: string): Promise<PostResultsResponse> =>
  request<PostResultsResponse>({
    method: 'GET',
    path: `/social-posts/${segment(postId)}/results`,
  });

export const retryFailedPlatforms = (
  postId: string,
  retryFailedPlatformsRequest: RetryFailedPlatformsRequest,
): Promise<PublishResponse> =>
  request<PublishResponse>({
    method: 'POST',
    path: `/social-posts/${segment(postId)}/retry`,
    body: retryFailedPlatformsRequest,
  });

export const bulkSchedulePosts = (
  bulkSchedulePostsRequest: BulkSchedulePostsRequest,
): Promise<BulkSchedulePostsResponse> =>
  request<BulkSchedulePostsResponse>({
    method: 'POST',
    path: '/social-posts/bulk',
    body: bulkSchedulePostsRequest,
  });

export const validateBulkPosts = (
  bulkSchedulePostsRequest: BulkSchedulePostsRequest,
): Promise<BulkPostValidationReport> =>
  request<BulkPostValidationReport>({
    method: 'POST',
    path: '/social-posts/bulk/validate',
    body: bulkSchedulePostsRequest,
  });

export const listRecurringPosts = (
  listRecurringPostsQuery: ListRecurringPostsQuery = {},
): Promise<ListRecurringPostsResponse> =>
  request<ListRecurringPostsResponse>({
    method: 'GET',
    path: '/recurring-posts',
    query: listRecurringPostsQuery,
  });

export const getRecurringPost = (recurringPostId: string): Promise<RecurringPost> =>
  request<RecurringPost>({
    method: 'GET',
    path: `/recurring-posts/${segment(recurringPostId)}`,
  });

export const pauseRecurringPost = (recurringPostId: string): Promise<RecurringPost> =>
  request<RecurringPost>({
    method: 'POST',
    path: `/recurring-posts/${segment(recurringPostId)}/pause`,
  });

export const resumeRecurringPost = (recurringPostId: string): Promise<RecurringPost> =>
  request<RecurringPost>({
    method: 'POST',
    path: `/recurring-posts/${segment(recurringPostId)}/resume`,
  });

export const deleteRecurringPost = (recurringPostId: string): Promise<DeletedResponse> =>
  request<DeletedResponse>({
    method: 'DELETE',
    path: `/recurring-posts/${segment(recurringPostId)}`,
  });

export const createConnectLink = (
  createConnectLinkRequest: CreateConnectLinkRequest = {},
): Promise<ConnectLink> =>
  request<ConnectLink>({
    method: 'POST',
    path: '/connect-links',
    body: createConnectLinkRequest,
  });

export const revokeConnectLink = (
  token: string,
): Promise<RevokeConnectLinkResponse> =>
  request<RevokeConnectLinkResponse>({
    method: 'DELETE',
    path: `/connect-links/${segment(token)}`,
  });

export const createWebhook = (
  createWebhookRequest: CreateWebhookRequest,
): Promise<CreatedWebhook> =>
  request<CreatedWebhook>({
    method: 'POST',
    path: '/webhooks',
    body: createWebhookRequest,
  });

export const listWebhooks = (): Promise<WebhooksResponse> =>
  request<WebhooksResponse>({ method: 'GET', path: '/webhooks' });

export const getWebhook = (webhookId: string): Promise<Webhook> =>
  request<Webhook>({ method: 'GET', path: `/webhooks/${segment(webhookId)}` });

export const updateWebhook = (
  webhookId: string,
  updateWebhookRequest: UpdateWebhookRequest,
): Promise<Webhook> =>
  request<Webhook>({
    method: 'PATCH',
    path: `/webhooks/${segment(webhookId)}`,
    body: updateWebhookRequest,
  });

export const deleteWebhook = (webhookId: string): Promise<DeletedResponse> =>
  request<DeletedResponse>({
    method: 'DELETE',
    path: `/webhooks/${segment(webhookId)}`,
  });

export const testWebhook = (webhookId: string): Promise<WebhookTestResult> =>
  request<WebhookTestResult>({
    method: 'POST',
    path: `/webhooks/${segment(webhookId)}/test`,
  });

export const getAnalyticsOverview = (
  analyticsRangeQuery: AnalyticsRangeQuery,
): Promise<AnalyticsOverview> =>
  request<AnalyticsOverview>({
    method: 'GET',
    path: '/analytics/overview',
    query: analyticsRangeQuery,
  });

export const getAnalyticsTimeseries = (
  analyticsTimeseriesQuery: AnalyticsTimeseriesQuery,
): Promise<AnalyticsTimeseriesResponse> =>
  request<AnalyticsTimeseriesResponse>({
    method: 'GET',
    path: '/analytics/timeseries',
    query: analyticsTimeseriesQuery,
  });

export const getPlatformBreakdown = (
  analyticsBreakdownQuery: AnalyticsBreakdownQuery,
): Promise<PlatformBreakdownResponse> =>
  request<PlatformBreakdownResponse>({
    method: 'GET',
    path: '/analytics/platform-breakdown',
    query: analyticsBreakdownQuery,
  });

export const listPostAnalytics = (
  analyticsPostsQuery: AnalyticsPostsQuery,
): Promise<ListPostAnalyticsResponse> =>
  request<ListPostAnalyticsResponse>({
    method: 'GET',
    path: '/analytics/posts',
    query: analyticsPostsQuery,
  });

export const listTopPosts = (
  analyticsTopPostsQuery: AnalyticsTopPostsQuery,
): Promise<TopPostsResponse> =>
  request<TopPostsResponse>({
    method: 'GET',
    path: '/analytics/top-posts',
    query: analyticsTopPostsQuery,
  });

export const listDiscoveredPosts = (
  analyticsDiscoveredPostsQuery: AnalyticsDiscoveredPostsQuery,
): Promise<DiscoveredPostsResponse> =>
  request<DiscoveredPostsResponse>({
    method: 'GET',
    path: '/analytics/discovered-posts',
    query: analyticsDiscoveredPostsQuery,
  });

export const getAnalyticsSyncStatus = (): Promise<AnalyticsSyncStatus> =>
  request<AnalyticsSyncStatus>({
    method: 'GET',
    path: '/analytics/sync-status',
  });

export const triggerAnalyticsSync = (): Promise<TriggerAnalyticsSyncResponse> =>
  request<TriggerAnalyticsSyncResponse>({
    method: 'POST',
    path: '/analytics/sync',
    idempotent: true,
  });

export const generateCaption = (
  generateCaptionRequest: GenerateCaptionRequest,
): Promise<CaptionResponse> =>
  request<CaptionResponse>({
    method: 'POST',
    path: '/ai/captions',
    body: generateCaptionRequest,
  });

export const refineCaption = (
  refineCaptionRequest: RefineCaptionRequest,
): Promise<CaptionResponse> =>
  request<CaptionResponse>({
    method: 'POST',
    path: '/ai/captions/refine',
    body: refineCaptionRequest,
  });

export const generateImage = (
  generateImageRequest: GenerateImageRequest,
): Promise<GenerateImageResponse> =>
  request<GenerateImageResponse>({
    method: 'POST',
    path: '/ai/images',
    body: generateImageRequest,
  });

export const getImageJob = (jobId: string): Promise<ImageJob> =>
  request<ImageJob>({
    method: 'GET',
    path: `/ai/images/${segment(jobId)}`,
  });

export const getInboxSummary = (): Promise<InboxSummary> =>
  request<InboxSummary>({ method: 'GET', path: '/inbox/summary' });

export const refreshInbox = (): Promise<{ queued: boolean }> =>
  request<{ queued: boolean }>({ method: 'POST', path: '/inbox/refresh', idempotent: true });

export const listInboxComments = (
  inboxCommentsQuery: InboxCommentsQuery = {},
): Promise<InboxCommentsResponse> =>
  request<InboxCommentsResponse>({ method: 'GET', path: '/inbox/comments', query: inboxCommentsQuery });

export const getInboxComment = (commentId: string): Promise<InboxCommentThread> =>
  request<InboxCommentThread>({ method: 'GET', path: `/inbox/comments/${segment(commentId)}` });

export const replyToInboxComment = (
  commentId: string,
  inboxTextRequest: InboxTextRequest,
): Promise<InboxComment> =>
  request<InboxComment>({
    method: 'POST',
    path: `/inbox/comments/${segment(commentId)}/reply`,
    body: inboxTextRequest,
  });

export const hideInboxComment = (commentId: string): Promise<InboxComment> =>
  request<InboxComment>({
    method: 'POST',
    path: `/inbox/comments/${segment(commentId)}/hide`,
    idempotent: true,
  });

export const unhideInboxComment = (commentId: string): Promise<InboxComment> =>
  request<InboxComment>({
    method: 'POST',
    path: `/inbox/comments/${segment(commentId)}/unhide`,
    idempotent: true,
  });

export const likeInboxComment = (commentId: string): Promise<InboxComment> =>
  request<InboxComment>({
    method: 'POST',
    path: `/inbox/comments/${segment(commentId)}/like`,
    idempotent: true,
  });

export const unlikeInboxComment = (commentId: string): Promise<InboxComment> =>
  request<InboxComment>({
    method: 'DELETE',
    path: `/inbox/comments/${segment(commentId)}/like`,
    idempotent: true,
  });

export const deleteInboxComment = (commentId: string): Promise<DeletedResponse> =>
  request<DeletedResponse>({ method: 'DELETE', path: `/inbox/comments/${segment(commentId)}` });

export const setInboxCommentsStatus = (
  inboxStatusRequest: InboxStatusRequest,
): Promise<InboxCommentsStatusResponse> =>
  request<InboxCommentsStatusResponse>({
    method: 'POST',
    path: '/inbox/comments/status',
    body: inboxStatusRequest,
    idempotent: true,
  });

export const listInboxMentions = (
  inboxListQuery: InboxListQuery = {},
): Promise<InboxMentionsResponse> =>
  request<InboxMentionsResponse>({ method: 'GET', path: '/inbox/mentions', query: inboxListQuery });

export const replyToInboxMention = (
  mentionId: string,
  inboxTextRequest: InboxTextRequest,
): Promise<InboxMention> =>
  request<InboxMention>({
    method: 'POST',
    path: `/inbox/mentions/${segment(mentionId)}/reply`,
    body: inboxTextRequest,
  });

export const setInboxMentionsStatus = (
  inboxStatusRequest: InboxStatusRequest,
): Promise<InboxMentionsStatusResponse> =>
  request<InboxMentionsStatusResponse>({
    method: 'POST',
    path: '/inbox/mentions/status',
    body: inboxStatusRequest,
    idempotent: true,
  });

export const listInboxConversations = (
  inboxListQuery: InboxListQuery = {},
): Promise<InboxConversationsResponse> =>
  request<InboxConversationsResponse>({ method: 'GET', path: '/inbox/conversations', query: inboxListQuery });

export const getInboxConversation = (conversationId: string): Promise<InboxConversationThread> =>
  request<InboxConversationThread>({
    method: 'GET',
    path: `/inbox/conversations/${segment(conversationId)}`,
  });

export const sendInboxMessage = (
  conversationId: string,
  inboxTextRequest: InboxTextRequest,
): Promise<SentInboxMessage> =>
  request<SentInboxMessage>({
    method: 'POST',
    path: `/inbox/conversations/${segment(conversationId)}/messages`,
    body: inboxTextRequest,
  });

export const setInboxConversationsStatus = (
  inboxStatusRequest: InboxStatusRequest,
): Promise<InboxConversationsStatusResponse> =>
  request<InboxConversationsStatusResponse>({
    method: 'POST',
    path: '/inbox/conversations/status',
    body: inboxStatusRequest,
    idempotent: true,
  });

export const listInboxReviews = (
  inboxReviewsQuery: InboxReviewsQuery = {},
): Promise<InboxReviewsResponse> =>
  request<InboxReviewsResponse>({
    method: 'GET',
    path: '/inbox/reviews',
    query: { ...inboxReviewsQuery, ratings: inboxReviewsQuery.ratings?.map(String) },
  });

export const replyToInboxReview = (
  reviewId: string,
  inboxTextRequest: InboxTextRequest,
): Promise<InboxReview> =>
  request<InboxReview>({
    method: 'PUT',
    path: `/inbox/reviews/${segment(reviewId)}/reply`,
    body: inboxTextRequest,
    idempotent: true,
  });

export const deleteInboxReviewReply = (reviewId: string): Promise<InboxReview> =>
  request<InboxReview>({
    method: 'DELETE',
    path: `/inbox/reviews/${segment(reviewId)}/reply`,
    idempotent: true,
  });

export const setInboxReviewsStatus = (
  inboxStatusRequest: InboxStatusRequest,
): Promise<InboxReviewsStatusResponse> =>
  request<InboxReviewsStatusResponse>({
    method: 'POST',
    path: '/inbox/reviews/status',
    body: inboxStatusRequest,
    idempotent: true,
  });
