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
  BulkSchedulePostsRequest,
  BulkSchedulePostsResponse,
  CaptionResponse,
  ConnectLink,
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
  ListPostAnalyticsResponse,
  ListPostsQuery,
  ListPostsResponse,
  Me,
  PlatformBreakdownResponse,
  PostResultsResponse,
  PublishDraftRequest,
  PublishResponse,
  RefineCaptionRequest,
  RetryFailedPlatformsRequest,
  RevokeConnectLinkResponse,
  SocialAccountCheck,
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

export const createConnectLink = (): Promise<ConnectLink> =>
  request<ConnectLink>({ method: 'POST', path: '/connect-links' });

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
