export const PLATFORM_TYPES = [
  'FACEBOOK',
  'INSTAGRAM',
  'THREADS',
  'TIKTOK',
  'TWITTER',
  'BLUESKY',
  'LINKEDIN',
  'PINTEREST',
  'YOUTUBE',
  'MASTODON',
] as const;
export type PlatformType = (typeof PLATFORM_TYPES)[number];

export const CONTENT_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'CAROUSEL'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const POST_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PENDING',
  'PUBLISHING',
  'COMPLETED',
  'PARTIAL_FAILURE',
  'FAILED',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const PLATFORM_POST_STATUSES = [
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
] as const;
export type PlatformPostStatus = (typeof PLATFORM_POST_STATUSES)[number];

export const POST_SORT_ORDERS = ['NEWEST', 'OLDEST'] as const;
export type PostSortOrder = (typeof POST_SORT_ORDERS)[number];

export const ANALYTICS_GRANULARITIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

export const ANALYTICS_SORT_METRICS = [
  'VIEWS',
  'LIKES',
  'COMMENTS',
  'SHARES',
  'SAVES',
  'CLICKS',
  'IMPRESSIONS',
  'ENGAGEMENT_RATE',
  'PUBLISHED_AT',
] as const;
export type AnalyticsSortMetric = (typeof ANALYTICS_SORT_METRICS)[number];

export const ANALYTICS_SYNC_JOB_STATUSES = [
  'IDLE',
  'QUEUED',
  'SYNCING',
  'FAILED',
] as const;
export type AnalyticsSyncJobStatus =
  (typeof ANALYTICS_SYNC_JOB_STATUSES)[number];

export const SOCIAL_ACCOUNT_STATUSES = ['active', 'unauthorized'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

export const TIKTOK_PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const;
export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number];

export const META_POST_TYPES = ['FEED', 'REEL', 'STORY'] as const;
export type MetaPostType = (typeof META_POST_TYPES)[number];

export const YOUTUBE_POST_TYPES = ['VIDEO', 'SHORTS'] as const;
export type YouTubePostType = (typeof YOUTUBE_POST_TYPES)[number];

export const YOUTUBE_PRIVACY_STATUSES = [
  'public',
  'private',
  'unlisted',
] as const;
export type YouTubePrivacyStatus = (typeof YOUTUBE_PRIVACY_STATUSES)[number];

export const YOUTUBE_LICENSES = ['youtube', 'creativeCommon'] as const;
export type YouTubeLicense = (typeof YOUTUBE_LICENSES)[number];

export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '4:5',
  '5:4',
  '21:9',
  '9:21',
] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const IMAGE_MODELS = ['standard', 'premium'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export const IMAGE_QUALITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const IMAGE_JOB_STATUSES = [
  'queued',
  'processing',
  'generating',
  'completed',
  'failed',
] as const;
export type ImageJobStatus = (typeof IMAGE_JOB_STATUSES)[number];

export const CAPTION_PLATFORMS = [
  'TWITTER',
  'BLUESKY',
  'MASTODON',
  'THREADS',
  'PINTEREST',
  'INSTAGRAM',
  'TIKTOK',
  'LINKEDIN',
  'YOUTUBE',
  'FACEBOOK',
] as const;
export type CaptionPlatform = (typeof CAPTION_PLATFORMS)[number];

export const WEBHOOK_EVENTS = [
  'post.published',
  'post.partially_failed',
  'post.failed',
  'post.scheduled',
  'account.unauthorized',
  'image.completed',
  'image.failed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Pagination {
  total: number;
  hasMore: boolean;
}

export interface PagePagination extends Pagination {
  page: number;
  limit: number;
}

export interface SocialAccount {
  id: string;
  platform: PlatformType;
  displayName: string;
  username: string;
  avatarUrl: string;
  status: SocialAccountStatus;
  unauthorizedReason?: string;
  pageId?: string;
}

export interface SocialAccountsResponse {
  accounts: SocialAccount[];
}

export type TokenType = 'api_token' | 'oauth';

export interface Me {
  tokenType: TokenType;
  tokenId: string | null;
  tokenName: string | null;
  workspace: { id: string; name: string | null };
  organizationId: string;
  role: { key: string; name: string };
  issuerRole: string | null;
  permissions: string[];
  can: { draft: boolean; schedule: boolean; publish: boolean };
  summary: string;
  expiresAt: string | null;
}

export interface SocialAccountCheck {
  id: string;
  platform: PlatformType;
  displayName: string;
  pageId?: string;
  status: SocialAccountStatus;
  unauthorizedReason?: string;
  checkedAt: string;
}

export interface UploadFileRequest {
  fileName: string;
  mimeType: UploadMimeType;
}

export interface CreateUploadUrlsRequest {
  files: UploadFileRequest[];
}

export interface UploadUrl {
  fileName: string;
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresAt: string;
}

export interface UploadUrlsResponse {
  urls: UploadUrl[];
}

export interface PlatformText {
  platform: PlatformType;
  text: string;
}

export interface PinterestPostConfig {
  connectionId: string;
  boardId: string;
  title?: string;
  link?: string;
}

export interface TikTokPostConfig {
  connectionId: string;
  privacyLevel: TikTokPrivacyLevel;
  title?: string;
  caption?: string;
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  sendAsDraft?: boolean;
  aiGenerated?: boolean;
  brandedContent?: boolean;
  brandedContentOwnBrand?: boolean;
  autoAddMusic?: boolean;
}

export interface InstagramPostConfig {
  connectionId: string;
  postType?: MetaPostType;
}

export interface FacebookPostConfig {
  pageId: string;
  postType?: MetaPostType;
  videoTitle?: string;
}

export interface YouTubePostConfig {
  connectionId: string;
  postType?: YouTubePostType;
  videoTitle?: string;
  tags?: string[];
  privacyStatus?: YouTubePrivacyStatus;
  license?: YouTubeLicense;
  notifySubscribers?: boolean;
  allowEmbedding?: boolean;
  madeForKids?: boolean;
  categoryId?: string;
  playlistId?: string;
}

export interface PostTargets {
  pageIds?: string[];
  tiktokConnectionIds?: string[];
  threadsConnectionIds?: string[];
  instagramConnectionIds?: string[];
  twitterConnectionIds?: string[];
  blueskyConnectionIds?: string[];
  mastodonConnectionIds?: string[];
  linkedinConnectionIds?: string[];
  pinterestConnectionIds?: string[];
  youtubeConnectionIds?: string[];
  pinterestConfigs?: PinterestPostConfig[];
  tiktokConfigs?: TikTokPostConfig[];
  instagramConfigs?: InstagramPostConfig[];
  facebookConfigs?: FacebookPostConfig[];
  youtubeConfigs?: YouTubePostConfig[];
}

export interface SocialPostPlatform {
  id: string;
  platform: PlatformType;
  status: PlatformPostStatus;
  connectionId?: string;
  pageId?: string;
  accountName?: string;
  text?: string;
  platformPostId?: string;
  postUrl?: string;
  errorMessage?: string;
  rawErrorMessage?: string;
  publishedAt?: string;
  mediaUrls: string[];
  previewUrls: string[];
  createdAt: string;
  updatedAt: string;
  linkedinDocumentTitle?: string;
  pinterestBoardId?: string;
  pinterestTitle?: string;
  pinterestLink?: string;
  tiktokTitle?: string;
  tiktokCaption?: string;
  tiktokPrivacyLevel?: TikTokPrivacyLevel;
  tiktokAllowComments?: boolean;
  tiktokAllowDuet?: boolean;
  tiktokAllowStitch?: boolean;
  tiktokSendAsDraft?: boolean;
  tiktokAiGenerated?: boolean;
  tiktokBrandedContent?: boolean;
  tiktokBrandedOwnBrand?: boolean;
  tiktokAutoAddMusic?: boolean;
  tiktokDraftFallback?: boolean;
  instagramPostType?: MetaPostType;
  facebookPostType?: MetaPostType;
  facebookVideoTitle?: string;
  facebookPageExternalId?: string;
  youtubePostType?: YouTubePostType;
  youtubeVideoTitle?: string;
  youtubeTags?: string[];
  youtubePrivacyStatus?: YouTubePrivacyStatus;
  youtubeLicense?: YouTubeLicense;
  youtubeNotifySubscribers?: boolean;
  youtubeAllowEmbedding?: boolean;
  youtubeMadeForKids?: boolean;
  youtubeCategoryId?: string;
  youtubePlaylistId?: string;
}

export interface SocialPost {
  id: string;
  userId: string;
  contentType: ContentType;
  text?: string;
  scheduledAt?: string;
  timezone: string;
  status: PostStatus;
  platforms: SocialPostPlatform[];
  createdAt: string;
  updatedAt: string;
}

export interface ListPostsResponse extends Pagination {
  posts: SocialPost[];
}

export type ListPostsQuery = {
  limit?: number;
  offset?: number;
  sortOrder?: PostSortOrder;
  statuses?: PostStatus[];
  platforms?: PlatformType[];
  startDate?: string;
  endDate?: string;
};

export interface CreatePostRequest extends PostTargets {
  platforms: PlatformType[];
  contentType: ContentType;
  timezone: string;
  text?: string;
  platformTexts?: PlatformText[];
  mediaUrls?: string[];
  mediaAltTexts?: string[];
  thumbnailUrl?: string;
  thumbnailTimestampMs?: number;
  scheduledAt?: string;
  saveAsDraft?: boolean;
}

export interface UpdatePostRequest extends PostTargets {
  platforms?: PlatformType[];
  contentType?: ContentType;
  timezone?: string;
  text?: string;
  platformTexts?: PlatformText[];
  mediaUrls?: string[];
  mediaAltTexts?: string[];
  thumbnailUrl?: string;
  thumbnailTimestampMs?: number;
  scheduledAt?: string;
}

export interface SkippedPlatform {
  platform: PlatformType;
  reason: string;
}

export interface CreatePostResponse {
  postId: string;
  queuedPlatforms: PlatformType[];
  skippedPlatforms: SkippedPlatform[];
  isScheduled: boolean;
  scheduledAt?: string;
}

export interface PublishResponse {
  postId: string;
  queuedPlatforms: PlatformType[];
  isScheduled: boolean;
  scheduledAt?: string;
}

export interface PublishDraftRequest {
  timezone: string;
  scheduledAt?: string;
}

export interface RetryFailedPlatformsRequest {
  platformIds: string[];
}

export interface DeletedResponse {
  deleted: boolean;
}

export interface PostResult {
  platformId: string;
  platform: PlatformType;
  accountName?: string | null;
  status: PlatformPostStatus;
  platformPostId?: string | null;
  errorMessage?: string | null;
  tiktokDraftFallback?: boolean | null;
  publishedAt?: string | null;
}

export interface PostResultsResponse {
  postId: string;
  status: PostStatus;
  results: PostResult[];
}

export interface BulkPostInput {
  contentType: ContentType;
  scheduledAt: string;
  text?: string;
  mediaUrls?: string[];
  mediaAltTexts?: string[];
  thumbnailUrl?: string;
  thumbnailTimestampMs?: number;
  platformTexts?: PlatformText[];
}

export interface BulkSchedulePostsRequest extends PostTargets {
  platforms: PlatformType[];
  timezone: string;
  posts: BulkPostInput[];
}

export interface BulkPostResult {
  postId?: string;
  success: boolean;
  isScheduled: boolean;
  scheduledAt?: string;
  errorMessage?: string;
}

export interface BulkSchedulePostsResponse {
  totalScheduled: number;
  totalFailed: number;
  results: BulkPostResult[];
}

export interface ConnectLink {
  url: string;
  token: string;
  expiresAt: string;
}

export interface RevokeConnectLinkResponse {
  success: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  disabledAt: string | null;
}

export interface CreatedWebhook extends Webhook {
  secret: string;
}

export interface WebhooksResponse {
  webhooks: Webhook[];
}

export interface CreateWebhookRequest {
  url: string;
}

export interface UpdateWebhookRequest {
  url?: string;
  active?: boolean;
}

export interface WebhookTestResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export type AnalyticsRangeQuery = {
  from: string;
  to: string;
  platforms?: PlatformType[];
};

export type AnalyticsBreakdownQuery = {
  from: string;
  to: string;
};

export type AnalyticsTimeseriesQuery = AnalyticsRangeQuery & {
  granularity?: AnalyticsGranularity;
};

export type AnalyticsPostsQuery = AnalyticsRangeQuery & {
  sortBy?: AnalyticsSortMetric;
  page?: number;
  limit?: number;
};

export type AnalyticsTopPostsQuery = AnalyticsRangeQuery & {
  sortBy?: AnalyticsSortMetric;
  limit?: number;
};

export type AnalyticsDiscoveredPostsQuery = AnalyticsRangeQuery & {
  limit?: number;
};

export interface AnalyticsMetricValue {
  value: number | null;
  previousValue: number | null;
  deltaPercent: number | null;
}

export interface AnalyticsOverview {
  views: AnalyticsMetricValue;
  likes: AnalyticsMetricValue;
  comments: AnalyticsMetricValue;
  shares: AnalyticsMetricValue;
  followers: AnalyticsMetricValue;
  postsCount: AnalyticsMetricValue;
  avgViewsPerPost: AnalyticsMetricValue;
  engagementRate: AnalyticsMetricValue;
  partialMetrics: string[];
  lastSyncedAt: string | null;
}

export interface AnalyticsTimeseriesPoint {
  date: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followers: number | null;
  postsCount: number | null;
  engagementRate: number | null;
}

export interface AnalyticsTimeseriesResponse {
  points: AnalyticsTimeseriesPoint[];
}

export interface PlatformBreakdown {
  platform: PlatformType;
  followers: AnalyticsMetricValue;
  views: AnalyticsMetricValue;
  likes: AnalyticsMetricValue;
  comments: AnalyticsMetricValue;
  shares: AnalyticsMetricValue;
  postsCount: AnalyticsMetricValue;
  avgViewsPerPost: AnalyticsMetricValue;
  engagementRate: AnalyticsMetricValue;
  supportedMetrics: string[];
}

export interface PlatformBreakdownResponse {
  platforms: PlatformBreakdown[];
}

export interface PostAnalyticsMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  impressions: number | null;
  reach: number | null;
  engagementRate: number | null;
}

export interface PostAnalytics {
  id: string;
  postId: string | null;
  postPlatformId: string | null;
  platform: PlatformType;
  publishedAt: string;
  title: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  accountName: string | null;
  metrics: PostAnalyticsMetrics;
}

export interface ListPostAnalyticsResponse extends PagePagination {
  posts: PostAnalytics[];
}

export interface TopPostsResponse {
  posts: PostAnalytics[];
}

export interface DiscoveredPost {
  id: string;
  platform: PlatformType;
  publishedAt: string;
  text: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  accountName: string | null;
}

export interface DiscoveredPostsResponse {
  posts: DiscoveredPost[];
}

export interface PlatformSyncStatus {
  platform: PlatformType;
  connectionId: string;
  accountName: string | null;
  status: AnalyticsSyncJobStatus;
  lastSyncedAt: string | null;
  lastErrorMessage: string | null;
  historyHorizonAt: string | null;
  lastDiscoveryAt: string | null;
  needsAnalyticsReconnect: boolean;
}

export interface AnalyticsSyncStatus {
  accountGroupId: string;
  syncInProgress: boolean;
  lastSyncedAt: string | null;
  historyHorizonAt: string | null;
  platforms: PlatformSyncStatus[];
}

export interface TriggerAnalyticsSyncResponse {
  queued: boolean;
  message: string;
  cooldownSecondsRemaining: number | null;
}

export interface GenerateCaptionRequest {
  prompt: string;
  platform?: CaptionPlatform;
}

export interface RefineCaptionRequest extends GenerateCaptionRequest {
  originalText: string;
  partialText?: string;
}

export interface CaptionResponse {
  caption: string;
}

export interface GenerateImageRequest {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  model?: ImageModel;
  quality?: ImageQuality;
  sessionId?: string;
  referenceImages?: string[];
}

export interface GenerateImageResponse {
  jobId: string;
  sessionId: string;
  status: ImageJobStatus;
}

export interface ImageJob {
  jobId: string;
  sessionId: string;
  status: ImageJobStatus;
  imageUrl: string | null;
  imageId: string | null;
  error: string | null;
}
