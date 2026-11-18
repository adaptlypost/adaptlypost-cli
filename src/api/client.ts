import { LONG_TIMEOUT_MS } from '../core/http.js';
import { callApi } from './transport.js';
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
  CreateWorkspaceRequest,
  CreatedWorkspace,
  CreatedWebhook,
  DeleteWorkspaceResponse,
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
  InboxRefreshResponse,
  InboxStatusRequest,
  InboxSummary,
  InboxTextRequest,
  SentInboxMessage,
  InstagramAudioResponse,
  Invitation,
  InvitationsResponse,
  LinkedInOrganizationLookupResponse,
  ListPostAnalyticsResponse,
  ListPostsQuery,
  ListPostsResponse,
  ListRecurringPostsQuery,
  ListRecurringPostsResponse,
  ListInvitationsQuery,
  LookupLinkedInOrganizationQuery,
  Me,
  MembersResponse,
  PinterestBoardsResponse,
  WordPressCategoriesResponse,
  PlatformBreakdownResponse,
  PostResultsResponse,
  PostValidationReport,
  PublishDraftRequest,
  PublishResponse,
  RecurringPost,
  RefineCaptionRequest,
  RemoveMemberResponse,
  RemoveOrganizationMemberResponse,
  RetryFailedPlatformsRequest,
  RevokeConnectLinkResponse,
  RevokedInvitation,
  SearchInstagramAudioQuery,
  SendInvitationRequest,
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
  WorkspacesResponse,
} from './types.js';

export const getMe = (): Promise<Me> => callApi((api, options) => api.me(options));

export const listSocialAccounts = (): Promise<SocialAccountsResponse> =>
  callApi((api, options) => api.accounts.list(options));

export const checkSocialAccount = (accountId: string): Promise<SocialAccountCheck> =>
  callApi((api, options) => api.accounts.check(accountId, options));

export const removeSocialAccount = (accountId: string): Promise<SocialAccountRemoval> =>
  callApi((api, options) => api.accounts.remove(accountId, options));

export const searchInstagramAudio = (
  accountId: string,
  searchInstagramAudioQuery: SearchInstagramAudioQuery,
): Promise<InstagramAudioResponse> =>
  callApi((api, options) => api.accounts.instagramAudio(accountId, searchInstagramAudioQuery, options));

export const listPinterestBoards = (accountId: string): Promise<PinterestBoardsResponse> =>
  callApi((api, options) => api.accounts.pinterestBoards(accountId, options));

export const listWordPressCategories = (accountId: string): Promise<WordPressCategoriesResponse> =>
  callApi((api, options) => api.accounts.wordpressCategories(accountId, options));

export const lookupLinkedInOrganization = (
  lookupLinkedInOrganizationQuery: LookupLinkedInOrganizationQuery,
): Promise<LinkedInOrganizationLookupResponse> =>
  callApi((api, options) => api.accounts.lookupLinkedInOrganization(lookupLinkedInOrganizationQuery, options));

export const createUploadUrls = (createUploadUrlsRequest: CreateUploadUrlsRequest): Promise<UploadUrlsResponse> =>
  callApi((api, options) => api.media.getUploadUrls(createUploadUrlsRequest, options));

export const listPosts = (listPostsQuery: ListPostsQuery = {}): Promise<ListPostsResponse> =>
  callApi((api, options) => api.posts.list(listPostsQuery, options));

export const getPost = (postId: string): Promise<SocialPost> =>
  callApi((api, options) => api.posts.get(postId, options));

export const createPost = (createPostRequest: CreatePostRequest): Promise<CreatePostResponse> =>
  callApi((api, options) => api.posts.create(createPostRequest, options));

export const validatePost = (createPostRequest: CreatePostRequest): Promise<PostValidationReport> =>
  callApi((api, options) => api.posts.validate(createPostRequest, options));

export const updatePost = (postId: string, updatePostRequest: UpdatePostRequest): Promise<SocialPost> =>
  callApi((api, options) => api.posts.update(postId, updatePostRequest, options));

export const deletePost = (postId: string): Promise<DeletedResponse> =>
  callApi((api, options) => api.posts.delete(postId, options));

export const unschedulePost = (postId: string): Promise<SocialPost> =>
  callApi((api, options) => api.posts.unschedule(postId, options));

export const publishDraft = (postId: string, publishDraftRequest: PublishDraftRequest): Promise<PublishResponse> =>
  callApi((api, options) => api.posts.publish(postId, publishDraftRequest, options));

export const listPostResults = (postId: string): Promise<PostResultsResponse> =>
  callApi((api, options) => api.posts.results(postId, options));

export const retryFailedPlatforms = (
  postId: string,
  retryFailedPlatformsRequest: RetryFailedPlatformsRequest,
): Promise<PublishResponse> =>
  callApi((api, options) => api.posts.retry(postId, retryFailedPlatformsRequest, options));

export const bulkSchedulePosts = (
  bulkSchedulePostsRequest: BulkSchedulePostsRequest,
): Promise<BulkSchedulePostsResponse> =>
  callApi((api, options) => api.posts.bulkSchedule(bulkSchedulePostsRequest, options));

export const validateBulkPosts = (
  bulkSchedulePostsRequest: BulkSchedulePostsRequest,
): Promise<BulkPostValidationReport> =>
  callApi((api, options) => api.posts.validateBulk(bulkSchedulePostsRequest, options));

export const listRecurringPosts = (
  listRecurringPostsQuery: ListRecurringPostsQuery = {},
): Promise<ListRecurringPostsResponse> =>
  callApi((api, options) => api.recurringPosts.list(listRecurringPostsQuery, options));

export const getRecurringPost = (recurringPostId: string): Promise<RecurringPost> =>
  callApi((api, options) => api.recurringPosts.get(recurringPostId, options));

export const pauseRecurringPost = (recurringPostId: string): Promise<RecurringPost> =>
  callApi((api, options) => api.recurringPosts.pause(recurringPostId, options));

export const resumeRecurringPost = (recurringPostId: string): Promise<RecurringPost> =>
  callApi((api, options) => api.recurringPosts.resume(recurringPostId, options));

export const deleteRecurringPost = (recurringPostId: string): Promise<DeletedResponse> =>
  callApi((api, options) => api.recurringPosts.delete(recurringPostId, options));

export const createConnectLink = (createConnectLinkRequest: CreateConnectLinkRequest = {}): Promise<ConnectLink> =>
  callApi((api, options) => api.connectLinks.create(createConnectLinkRequest, options));

export const revokeConnectLink = (token: string): Promise<RevokeConnectLinkResponse> =>
  callApi((api, options) => api.connectLinks.revoke(token, options));

export const createWebhook = (createWebhookRequest: CreateWebhookRequest): Promise<CreatedWebhook> =>
  callApi((api, options) => api.webhooks.create(createWebhookRequest, options));

export const listWebhooks = (): Promise<WebhooksResponse> => callApi((api, options) => api.webhooks.list(options));

export const getWebhook = (webhookId: string): Promise<Webhook> =>
  callApi((api, options) => api.webhooks.get(webhookId, options));

export const updateWebhook = (webhookId: string, updateWebhookRequest: UpdateWebhookRequest): Promise<Webhook> =>
  callApi((api, options) => api.webhooks.update(webhookId, updateWebhookRequest, options));

export const deleteWebhook = (webhookId: string): Promise<DeletedResponse> =>
  callApi((api, options) => api.webhooks.delete(webhookId, options));

export const testWebhook = (webhookId: string): Promise<WebhookTestResult> =>
  callApi((api, options) => api.webhooks.test(webhookId, options));

export const listWorkspaces = (): Promise<WorkspacesResponse> => callApi((api, options) => api.workspaces.list(options));

export const createWorkspace = (createWorkspaceRequest: CreateWorkspaceRequest): Promise<CreatedWorkspace> =>
  callApi((api, options) => api.workspaces.create(createWorkspaceRequest, options));

export const deleteWorkspace = (workspaceId: string): Promise<DeleteWorkspaceResponse> =>
  callApi((api, options) => api.workspaces.delete(workspaceId, options));

export const listMembers = (): Promise<MembersResponse> => callApi((api, options) => api.members.list(options));

export const removeMember = (userId: string): Promise<RemoveMemberResponse> =>
  callApi((api, options) => api.members.remove(userId, options));

export const removeOrganizationMember = (userId: string): Promise<RemoveOrganizationMemberResponse> =>
  callApi((api, options) => api.members.removeFromOrganization(userId, options));

export const listInvitations = (listInvitationsQuery: ListInvitationsQuery = {}): Promise<InvitationsResponse> =>
  callApi((api, options) => api.invitations.list(listInvitationsQuery, options));

export const sendInvitation = (sendInvitationRequest: SendInvitationRequest): Promise<Invitation> =>
  callApi((api, options) => api.invitations.send(sendInvitationRequest, options));

export const revokeInvitation = (invitationId: string): Promise<RevokedInvitation> =>
  callApi((api, options) => api.invitations.revoke(invitationId, options));

export const getAnalyticsOverview = (analyticsRangeQuery: AnalyticsRangeQuery): Promise<AnalyticsOverview> =>
  callApi((api, options) => api.analytics.overview(analyticsRangeQuery, options));

export const getAnalyticsTimeseries = (
  analyticsTimeseriesQuery: AnalyticsTimeseriesQuery,
): Promise<AnalyticsTimeseriesResponse> =>
  callApi((api, options) => api.analytics.timeseries(analyticsTimeseriesQuery, options));

export const getPlatformBreakdown = (
  analyticsBreakdownQuery: AnalyticsBreakdownQuery,
): Promise<PlatformBreakdownResponse> =>
  callApi((api, options) => api.analytics.platformBreakdown(analyticsBreakdownQuery, options));

export const listPostAnalytics = (analyticsPostsQuery: AnalyticsPostsQuery): Promise<ListPostAnalyticsResponse> =>
  callApi((api, options) => api.analytics.posts(analyticsPostsQuery, options));

export const listTopPosts = (analyticsTopPostsQuery: AnalyticsTopPostsQuery): Promise<TopPostsResponse> =>
  callApi((api, options) => api.analytics.topPosts(analyticsTopPostsQuery, options));

export const listDiscoveredPosts = (
  analyticsDiscoveredPostsQuery: AnalyticsDiscoveredPostsQuery,
): Promise<DiscoveredPostsResponse> =>
  callApi((api, options) => api.analytics.discoveredPosts(analyticsDiscoveredPostsQuery, options));

export const getAnalyticsSyncStatus = (): Promise<AnalyticsSyncStatus> =>
  callApi((api, options) => api.analytics.syncStatus(options));

export const triggerAnalyticsSync = (): Promise<TriggerAnalyticsSyncResponse> =>
  callApi((api, options) => api.analytics.sync(options));

export const generateCaption = (generateCaptionRequest: GenerateCaptionRequest): Promise<CaptionResponse> =>
  callApi((api, options) => api.ai.generateCaption(generateCaptionRequest, options), LONG_TIMEOUT_MS);

export const refineCaption = (refineCaptionRequest: RefineCaptionRequest): Promise<CaptionResponse> =>
  callApi((api, options) => api.ai.refineCaption(refineCaptionRequest, options), LONG_TIMEOUT_MS);

export const generateImage = (generateImageRequest: GenerateImageRequest): Promise<GenerateImageResponse> =>
  callApi((api, options) => api.ai.generateImage(generateImageRequest, options), LONG_TIMEOUT_MS);

export const getImageJob = (jobId: string): Promise<ImageJob> =>
  callApi((api, options) => api.ai.getImageJob(jobId, options));

export const getInboxSummary = (): Promise<InboxSummary> => callApi((api, options) => api.inbox.summary(options));

export const refreshInbox = (): Promise<InboxRefreshResponse> => callApi((api, options) => api.inbox.refresh(options));

export const listInboxComments = (inboxCommentsQuery: InboxCommentsQuery = {}): Promise<InboxCommentsResponse> =>
  callApi((api, options) => api.inbox.comments.list(inboxCommentsQuery, options));

export const getInboxComment = (commentId: string): Promise<InboxCommentThread> =>
  callApi((api, options) => api.inbox.comments.get(commentId, options));

export const replyToInboxComment = (commentId: string, inboxTextRequest: InboxTextRequest): Promise<InboxComment> =>
  callApi((api, options) => api.inbox.comments.reply(commentId, inboxTextRequest, options));

export const hideInboxComment = (commentId: string): Promise<InboxComment> =>
  callApi((api, options) => api.inbox.comments.hide(commentId, options));

export const unhideInboxComment = (commentId: string): Promise<InboxComment> =>
  callApi((api, options) => api.inbox.comments.unhide(commentId, options));

export const likeInboxComment = (commentId: string): Promise<InboxComment> =>
  callApi((api, options) => api.inbox.comments.like(commentId, options));

export const unlikeInboxComment = (commentId: string): Promise<InboxComment> =>
  callApi((api, options) => api.inbox.comments.unlike(commentId, options));

export const deleteInboxComment = (commentId: string): Promise<DeletedResponse> =>
  callApi((api, options) => api.inbox.comments.delete(commentId, options));

export const setInboxCommentsStatus = (inboxStatusRequest: InboxStatusRequest): Promise<InboxCommentsStatusResponse> =>
  callApi((api, options) => api.inbox.comments.updateStatus(inboxStatusRequest, options));

export const listInboxMentions = (inboxListQuery: InboxListQuery = {}): Promise<InboxMentionsResponse> =>
  callApi((api, options) => api.inbox.mentions.list(inboxListQuery, options));

export const replyToInboxMention = (mentionId: string, inboxTextRequest: InboxTextRequest): Promise<InboxMention> =>
  callApi((api, options) => api.inbox.mentions.reply(mentionId, inboxTextRequest, options));

export const setInboxMentionsStatus = (inboxStatusRequest: InboxStatusRequest): Promise<InboxMentionsStatusResponse> =>
  callApi((api, options) => api.inbox.mentions.updateStatus(inboxStatusRequest, options));

export const listInboxConversations = (inboxListQuery: InboxListQuery = {}): Promise<InboxConversationsResponse> =>
  callApi((api, options) => api.inbox.conversations.list(inboxListQuery, options));

export const getInboxConversation = (conversationId: string): Promise<InboxConversationThread> =>
  callApi((api, options) => api.inbox.conversations.get(conversationId, options));

export const sendInboxMessage = (
  conversationId: string,
  inboxTextRequest: InboxTextRequest,
): Promise<SentInboxMessage> =>
  callApi((api, options) => api.inbox.conversations.sendMessage(conversationId, inboxTextRequest, options));

export const setInboxConversationsStatus = (
  inboxStatusRequest: InboxStatusRequest,
): Promise<InboxConversationsStatusResponse> =>
  callApi((api, options) => api.inbox.conversations.updateStatus(inboxStatusRequest, options));

export const listInboxReviews = (inboxReviewsQuery: InboxReviewsQuery = {}): Promise<InboxReviewsResponse> =>
  callApi((api, options) => api.inbox.reviews.list(inboxReviewsQuery, options));

export const replyToInboxReview = (reviewId: string, inboxTextRequest: InboxTextRequest): Promise<InboxReview> =>
  callApi((api, options) => api.inbox.reviews.reply(reviewId, inboxTextRequest, options));

export const deleteInboxReviewReply = (reviewId: string): Promise<InboxReview> =>
  callApi((api, options) => api.inbox.reviews.deleteReply(reviewId, options));

export const setInboxReviewsStatus = (inboxStatusRequest: InboxStatusRequest): Promise<InboxReviewsStatusResponse> =>
  callApi((api, options) => api.inbox.reviews.updateStatus(inboxStatusRequest, options));
