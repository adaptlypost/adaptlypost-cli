import type { QueryParams, RequestBody, ResponseBody, Schemas } from '@adaptlypost/sdk';

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
  'TELEGRAM',
  'TUMBLR',
  'WORDPRESS',
  'GOOGLE_BUSINESS',
] as const satisfies readonly PlatformType[];
export type PlatformType = Schemas['PlatformType'];

export const CONTENT_TYPES = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'CAROUSEL',
  'DOCUMENT',
] as const satisfies readonly ContentType[];
export type ContentType = Schemas['ContentType'];

export const POST_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PENDING',
  'PUBLISHING',
  'COMPLETED',
  'PARTIAL_FAILURE',
  'FAILED',
] as const satisfies readonly PostStatus[];
export type PostStatus = Schemas['PostStatus'];

export const PLATFORM_POST_STATUSES = [
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
] as const satisfies readonly PlatformPostStatus[];
export type PlatformPostStatus = Schemas['PlatformPostStatus'];

export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const satisfies readonly RecurrenceFrequency[];
export type RecurrenceFrequency = Schemas['Recurrence']['frequency'];

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const satisfies readonly Weekday[];
export type Weekday = NonNullable<Schemas['Recurrence']['weekdays']>[number];

export const RECURRING_POST_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'] as const satisfies readonly RecurringPostStatus[];
export type RecurringPostStatus = NonNullable<Schemas['RecurringPost']['status']>;

export const RECURRING_POST_PAUSE_REASONS = [
  'USER',
  'CONSECUTIVE_FAILURES',
  'SUBSCRIPTION_INACTIVE',
  'ACCESS_LOST',
  'CONNECTION_REMOVED',
  'INVALID_CONTENT',
] as const satisfies readonly RecurringPostPauseReason[];
export type RecurringPostPauseReason = NonNullable<Schemas['RecurringPost']['pauseReason']>;

export const POST_SORT_ORDERS = ['NEWEST', 'OLDEST'] as const;
export type PostSortOrder = (typeof POST_SORT_ORDERS)[number];

export const ANALYTICS_GRANULARITIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const satisfies readonly AnalyticsGranularity[];
export type AnalyticsGranularity = Schemas['AnalyticsGranularity'];

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
] as const satisfies readonly AnalyticsSortMetric[];
export type AnalyticsSortMetric = Schemas['AnalyticsSortMetric'];

export const ANALYTICS_SYNC_JOB_STATUSES = [
  'IDLE',
  'QUEUED',
  'SYNCING',
  'FAILED',
] as const satisfies readonly AnalyticsSyncJobStatus[];
export type AnalyticsSyncJobStatus = Schemas['AnalyticsSyncJobStatus'];

export const SOCIAL_ACCOUNT_STATUSES = ['active', 'unauthorized'] as const satisfies readonly SocialAccountStatus[];
export type SocialAccountStatus = Schemas['SocialAccountStatus'];

export const UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const satisfies readonly UploadMimeType[];
export type UploadMimeType = RequestBody<'getUploadUrls'>['files'][number]['mimeType'];

export const TIKTOK_PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const satisfies readonly TikTokPrivacyLevel[];
export type TikTokPrivacyLevel = Schemas['TikTokPostConfig']['privacyLevel'];

export const META_POST_TYPES = ['FEED', 'REEL', 'STORY'] as const satisfies readonly MetaPostType[];
export type MetaPostType = NonNullable<Schemas['InstagramPostConfig']['postType']>;

export const FACEBOOK_IMAGE_LAYOUTS = ['GRID', 'CAROUSEL'] as const satisfies readonly FacebookImageLayout[];
export type FacebookImageLayout = Schemas['FacebookPostConfig']['imageLayout'];

export const FACEBOOK_CAROUSEL_CARDS_MAX = 5;

export type FacebookCarouselCard = Schemas['FacebookCarouselCard'];

export const INSTAGRAM_TRIAL_GRADUATIONS = ['MANUAL', 'SS_PERFORMANCE'] as const satisfies readonly InstagramTrialGraduation[];
export type InstagramTrialGraduation = NonNullable<Schemas['InstagramPostConfig']['trialGraduation']>;

export const INSTAGRAM_COLLABORATORS_MAX = 3;
export const INSTAGRAM_USER_TAGS_MAX = 20;
export const INSTAGRAM_AUDIO_VOLUME_MIN = 1;
export const INSTAGRAM_AUDIO_VOLUME_MAX = 100;
export const INSTAGRAM_AUDIO_SEARCH_MAX_LENGTH = 100;
export const PINTEREST_BOARD_NAME_MAX_LENGTH = 180;
export const TUMBLR_TAGS_MAX = 30;
export const TUMBLR_TAG_MAX_LENGTH = 140;
export const TUMBLR_TITLE_MAX_LENGTH = 4096;
export const TUMBLR_SOURCE_URL_MAX_LENGTH = 2048;
export const WORDPRESS_TITLE_MAX_LENGTH = 300;
export const WORDPRESS_EXCERPT_MAX_LENGTH = 1000;
export const WORDPRESS_CATEGORIES_MAX = 50;
export const WORDPRESS_TAGS_MAX = 50;
export const WORDPRESS_TAG_MAX_LENGTH = 100;
export const WORDPRESS_POST_STATUSES = ['PUBLISH', 'DRAFT', 'PENDING'] as const satisfies readonly WordPressPostStatus[];
export type WordPressPostStatus = Schemas['WordPressPostConfig']['status'];
export const YOUTUBE_AUDIO_LANGUAGE_MAX_LENGTH = 35;
export const MEDIA_ALT_TEXT_MAX_LENGTH = 1000;
export const YOUTUBE_AUDIO_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export const INSTAGRAM_AUDIO_TYPES = ['music', 'original_sound'] as const satisfies readonly InstagramAudioType[];
export type InstagramAudioType = NonNullable<Schemas['InstagramAudio']['audioType']>;

export const GOOGLE_BUSINESS_TOPIC_TYPES = ['STANDARD', 'EVENT', 'OFFER'] as const satisfies readonly GoogleBusinessTopicType[];
export type GoogleBusinessTopicType = Schemas['GoogleBusinessPostConfig']['topicType'];

export const GOOGLE_BUSINESS_CALL_TO_ACTION_TYPES = [
  'BOOK',
  'ORDER',
  'SHOP',
  'LEARN_MORE',
  'SIGN_UP',
  'CALL',
] as const satisfies readonly GoogleBusinessCallToActionType[];
export type GoogleBusinessCallToActionType = NonNullable<Schemas['GoogleBusinessPostConfig']['callToActionType']>;

export const MEDIA_ASPECT_RATIOS = ['SQUARE', 'PORTRAIT', 'VERTICAL', 'LANDSCAPE'] as const satisfies readonly MediaAspectRatio[];
export type MediaAspectRatio = Schemas['PlatformAspectRatio']['aspectRatio'];

export const MEDIA_ASPECT_RATIO_FITS = ['CROP', 'PAD'] as const satisfies readonly MediaAspectRatioFit[];
export type MediaAspectRatioFit = NonNullable<Schemas['PlatformAspectRatio']['fit']>;

export const ASPECT_RATIOS_BY_PLATFORM: Partial<Record<PlatformType, readonly MediaAspectRatio[]>> = {
  INSTAGRAM: ['SQUARE', 'PORTRAIT', 'LANDSCAPE'],
  TIKTOK: MEDIA_ASPECT_RATIOS,
};

export const FIRST_COMMENT_MAX_LENGTH: Partial<Record<PlatformType, number>> = {
  LINKEDIN: 1250,
  TWITTER: 280,
  THREADS: 500,
  BLUESKY: 300,
  MASTODON: 500,
  YOUTUBE: 10000,
  FACEBOOK: 8000,
  INSTAGRAM: 2200,
};

export const FIRST_COMMENT_MAX_DELAY_MINUTES = 10080;

export const FIRST_COMMENT_STATUSES = ['PENDING', 'PUBLISHED', 'FAILED'] as const satisfies readonly FirstCommentStatus[];
export type FirstCommentStatus = Schemas['FirstCommentStatus'];

export const THREAD_PLATFORMS = ['TWITTER', 'THREADS', 'BLUESKY', 'MASTODON'] as const satisfies readonly PlatformType[];
export const THREAD_MAX_REPLIES = 25;
export const THREAD_REPLY_MAX_IMAGES = 4;

/** X Premium accounts and Mastodon instances can allow more, so only the server checks those two. */
export const THREAD_REPLY_MAX_LENGTH: Partial<Record<PlatformType, number>> = {
  THREADS: 500,
  BLUESKY: 300,
};

export const THREAD_REPLY_USUAL_LENGTH: Record<(typeof THREAD_PLATFORMS)[number], string> = {
  TWITTER: '280, more on X Premium',
  THREADS: '500',
  BLUESKY: '300',
  MASTODON: "500, or the instance's limit",
};

export const THREAD_STATUSES = ['PENDING', 'PUBLISHED', 'FAILED'] as const satisfies readonly ThreadStatus[];
export type ThreadStatus = Schemas['PostThreadStatus'];

export type ThumbnailKind = 'image' | 'frame' | 'image-or-frame';

export const THUMBNAIL_KIND_BY_PLATFORM: Partial<Record<PlatformType, ThumbnailKind>> = {
  YOUTUBE: 'image-or-frame',
  FACEBOOK: 'image-or-frame',
  LINKEDIN: 'image-or-frame',
  INSTAGRAM: 'image-or-frame',
  PINTEREST: 'image-or-frame',
  TIKTOK: 'frame',
  TELEGRAM: 'image-or-frame',
};

export const YOUTUBE_POST_TYPES = ['VIDEO', 'SHORTS'] as const satisfies readonly YouTubePostType[];
export type YouTubePostType = NonNullable<Schemas['YouTubePostConfig']['postType']>;

export const YOUTUBE_PRIVACY_STATUSES = [
  'public',
  'private',
  'unlisted',
] as const satisfies readonly YouTubePrivacyStatus[];
export type YouTubePrivacyStatus = NonNullable<Schemas['YouTubePostConfig']['privacyStatus']>;

export const YOUTUBE_LICENSES = ['youtube', 'creativeCommon'] as const satisfies readonly YouTubeLicense[];
export type YouTubeLicense = NonNullable<Schemas['YouTubePostConfig']['license']>;

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
] as const satisfies readonly ImageAspectRatio[];
export type ImageAspectRatio = Schemas['ImageAspectRatio'];

export const IMAGE_MODELS = ['standard', 'premium'] as const satisfies readonly ImageModel[];
export type ImageModel = Schemas['ImageModel'];

export const IMAGE_QUALITIES = ['LOW', 'MEDIUM', 'HIGH'] as const satisfies readonly ImageQuality[];
export type ImageQuality = Schemas['ImageQuality'];

export const IMAGE_JOB_STATUSES = [
  'queued',
  'processing',
  'generating',
  'completed',
  'failed',
] as const satisfies readonly ImageJobStatus[];
export type ImageJobStatus = Schemas['ImageJobStatus'];

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
  'GOOGLE_BUSINESS',
] as const satisfies readonly Schemas['CaptionPlatform'][];
export type CaptionPlatform = (typeof CAPTION_PLATFORMS)[number];

export const DEFAULT_WEBHOOK_EVENTS = [
  'post.published',
  'post.partially_failed',
  'post.failed',
  'post.scheduled',
  'account.unauthorized',
  'image.completed',
  'image.failed',
] as const;

export const INBOX_WEBHOOK_EVENTS = [
  'comment.created',
  'comment.replied',
  'mention.created',
  'message.received',
  'review.created',
] as const;

export type WebhookEvent = Schemas['WebhookEventName'];
export const WEBHOOK_EVENTS = [...DEFAULT_WEBHOOK_EVENTS, ...INBOX_WEBHOOK_EVENTS] as const satisfies readonly WebhookEvent[];

export type InstagramAudio = Schemas['InstagramAudio'];
export type InstagramAudioResponse = ResponseBody<'searchInstagramAudio'>;
export type SearchInstagramAudioQuery = QueryParams<'searchInstagramAudio'>;

export type SocialAccount = Schemas['SocialAccount'];
export type SocialAccountsResponse = ResponseBody<'listSocialAccounts'>;
export type SocialAccountCheck = ResponseBody<'checkSocialAccount'>;
export type SocialAccountRemoval = ResponseBody<'removeSocialAccount'>;

export type PinterestBoard = Schemas['PinterestBoard'];
export type PinterestBoardsResponse = ResponseBody<'getPinterestBoards'>;

export type WordPressCategory = Schemas['WordPressCategory'];
export type WordPressCategoriesResponse = ResponseBody<'getWordPressCategories'>;

export const LINKEDIN_ORGANIZATION_QUERY_MAX_LENGTH = 300;

export type LookupLinkedInOrganizationQuery = QueryParams<'lookupLinkedInOrganization'>;
export type LinkedInOrganization = Schemas['LinkedInOrganization'];
export type LinkedInOrganizationLookupResponse = ResponseBody<'lookupLinkedInOrganization'>;

export type Me = ResponseBody<'getMe'>;

export type CreateUploadUrlsRequest = RequestBody<'getUploadUrls'>;
export type UploadUrlsResponse = ResponseBody<'getUploadUrls'>;
export type UploadUrl = NonNullable<UploadUrlsResponse['urls']>[number];

export type PlatformText = Schemas['PlatformText'];
export type PlatformFirstComment = Schemas['PlatformFirstComment'];
export type PlatformThreadReplies = Schemas['PlatformThreadReplies'];
export type PlatformThumbnail = Schemas['PlatformThumbnail'];
export type PlatformMedia = Schemas['PlatformMedia'];
export type PlatformAspectRatio = Schemas['PlatformAspectRatio'];

export type PlatformExtras = Pick<
  CreatePostRequest,
  'firstComments' | 'threadReplies' | 'platformThumbnails' | 'platformAspectRatios' | 'platformMedia'
>;
export type PinterestPostConfig = Schemas['PinterestPostConfig'];
export type TikTokPostConfig = Schemas['TikTokPostConfig'];
export type InstagramAudioConfig = Schemas['InstagramAudioConfig'];
export type InstagramUserTag = Schemas['InstagramUserTag'];
export type InstagramPostConfig = Schemas['InstagramPostConfig'];
export type GoogleBusinessPostConfig = Schemas['GoogleBusinessPostConfig'];
export type YouTubePostConfig = Schemas['YouTubePostConfig'];
export type LinkedInPostConfig = Schemas['LinkedInPostConfig'];
export type TwitterPostConfig = Schemas['TwitterPostConfig'];
export type TumblrPostConfig = Schemas['TumblrPostConfig'];

export type FacebookPostConfig = Schemas['FacebookPostConfig'];
export type WordPressPostConfig = Schemas['WordPressPostConfig'];

export const LINKEDIN_RESHARE_OF_MAX_LENGTH = 500;
export const TWITTER_QUOTE_OF_MAX_LENGTH = 200;

export type CreatePostRequest = RequestBody<'createPost'>;
export type UpdatePostRequest = RequestBody<'updatePost'>;
export type BulkSchedulePostsRequest = RequestBody<'bulkSchedulePosts'>;
export type BulkPostInput = Schemas['BulkPostItem'];

export type PostTargets = Pick<
  CreatePostRequest,
  | 'pageIds'
  | 'tiktokConnectionIds'
  | 'threadsConnectionIds'
  | 'instagramConnectionIds'
  | 'twitterConnectionIds'
  | 'blueskyConnectionIds'
  | 'mastodonConnectionIds'
  | 'telegramConnectionIds'
  | 'tumblrConnectionIds'
  | 'wordpressConnectionIds'
  | 'googleBusinessConnectionIds'
  | 'linkedinConnectionIds'
  | 'pinterestConnectionIds'
  | 'youtubeConnectionIds'
  | 'pinterestConfigs'
  | 'tiktokConfigs'
  | 'instagramConfigs'
  | 'facebookConfigs'
  | 'youtubeConfigs'
  | 'linkedinConfigs'
  | 'twitterConfigs'
  | 'tumblrConfigs'
  | 'wordpressConfigs'
  | 'googleBusinessConfigs'
>;

export type SocialPostPlatform = Schemas['PostPlatform'];
export type SocialPost = ResponseBody<'getPost'>;
export type ListPostsResponse = ResponseBody<'listPosts'>;
export type ListPostsQuery = QueryParams<'listPosts'>;

export type Recurrence = Schemas['Recurrence'];

export type RecurringPost = Schemas['RecurringPost'];
export type ListRecurringPostsResponse = ResponseBody<'listRecurringPosts'>;
export type ListRecurringPostsQuery = QueryParams<'listRecurringPosts'>;

export type CreatePostResponse = ResponseBody<'createPost'>;

export type PostIssue = Schemas['PostIssue'];
export type PostIssueSeverity = PostIssue['severity'];
export type PostAccountCheck = Schemas['PostAccountCheck'];
export type PostAccountStatus = PostAccountCheck['status'];
export type PostValidationReport = Schemas['PostValidationReport'];
export type PostValidationOutcome = PostValidationReport['outcome'];
export type BulkPostValidationReport = ResponseBody<'validateBulkPosts'>;

export type PublishResponse = ResponseBody<'publishDraft'>;
export type PublishDraftRequest = RequestBody<'publishDraft'>;
export type RetryFailedPlatformsRequest = RequestBody<'retryFailedPlatforms'>;
export type DeletedResponse = ResponseBody<'deletePost'>;

export type PostResultsResponse = ResponseBody<'getPostResults'>;
export type PostResult = NonNullable<PostResultsResponse['results']>[number];

export type BulkSchedulePostsResponse = ResponseBody<'bulkSchedulePosts'>;
export type BulkPostResult = NonNullable<BulkSchedulePostsResponse['results']>[number];

export type CreateConnectLinkRequest = RequestBody<'createConnectLink'>;
export type ConnectLinkVisibility = NonNullable<CreateConnectLinkRequest['visibility']>;
export const CONNECT_LINK_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const satisfies readonly ConnectLinkVisibility[];
export type ConnectLink = ResponseBody<'createConnectLink'>;
export type RevokeConnectLinkResponse = ResponseBody<'revokeConnectLink'>;

export type Webhook = Schemas['Webhook'];
export type CreatedWebhook = ResponseBody<'createWebhook'>;
export type WebhooksResponse = ResponseBody<'listWebhooks'>;
export type CreateWebhookRequest = RequestBody<'createWebhook'>;
export type UpdateWebhookRequest = RequestBody<'updateWebhook'>;
export type WebhookTestResult = ResponseBody<'testWebhook'>;

export type WorkspaceSummary = Schemas['Workspace'];
export type WorkspacesResponse = ResponseBody<'listWorkspaces'>;
export type CreateWorkspaceRequest = RequestBody<'createWorkspace'>;
export type CreatedWorkspace = ResponseBody<'createWorkspace'>;
export type DeleteWorkspaceResponse = ResponseBody<'deleteWorkspace'>;
export const WORKSPACE_NAME_MAX_LENGTH = 100;
export const WORKSPACE_DESCRIPTION_MAX_LENGTH = 500;
export const WORKSPACE_CONNECTION_LIMIT_MAX = 10000;

export type MembersResponse = ResponseBody<'listMembers'>;
export type WorkspaceMember = MembersResponse['members'][number];
export type WorkspaceRole = WorkspaceMember['role'];
export const WORKSPACE_ROLES = ['admin', 'editor', 'contributor', 'viewer'] as const satisfies readonly WorkspaceRole[];
export type RemoveMemberResponse = ResponseBody<'removeMember'>;
export type RemoveOrganizationMemberResponse = ResponseBody<'removeOrganizationMember'>;

export type SendInvitationRequest = RequestBody<'sendInvitation'>;
export type InvitationWorkspace = SendInvitationRequest['workspaces'][number];
export type OrganizationRole = NonNullable<SendInvitationRequest['organizationRole']>;
export type CreditAllowance = NonNullable<SendInvitationRequest['creditAllowance']>;
export const CREDIT_ALLOWANCE_MAX = 100000;
export type Invitation = ResponseBody<'sendInvitation'>;
export type InvitationsResponse = ResponseBody<'listInvitations'>;
export type ListInvitationsQuery = QueryParams<'listInvitations'>;
export type RevokedInvitation = ResponseBody<'revokeInvitation'>;

export type AnalyticsRangeQuery = QueryParams<'getAnalyticsOverview'>;
export type AnalyticsBreakdownQuery = QueryParams<'getAnalyticsPlatformBreakdown'>;
export type AnalyticsTimeseriesQuery = QueryParams<'getAnalyticsTimeseries'>;
export type AnalyticsPostsQuery = QueryParams<'listPostAnalytics'>;
export type AnalyticsTopPostsQuery = QueryParams<'listTopPosts'>;
export type AnalyticsDiscoveredPostsQuery = QueryParams<'listDiscoveredPosts'>;

export type AnalyticsMetricValue = Schemas['AnalyticsMetricValue'];
export type AnalyticsOverview = ResponseBody<'getAnalyticsOverview'>;
export type AnalyticsTimeseriesPoint = Schemas['AnalyticsTimeseriesPoint'];
export type AnalyticsTimeseriesResponse = ResponseBody<'getAnalyticsTimeseries'>;
export type PlatformBreakdown = Schemas['AnalyticsPlatformBreakdownItem'];
export type PlatformBreakdownResponse = ResponseBody<'getAnalyticsPlatformBreakdown'>;
export type PostAnalyticsMetrics = Schemas['AnalyticsPostMetrics'];
export type PostAnalytics = Schemas['AnalyticsPost'];
export type ListPostAnalyticsResponse = ResponseBody<'listPostAnalytics'>;
export type TopPostsResponse = ResponseBody<'listTopPosts'>;
export type DiscoveredPost = Schemas['DiscoveredPost'];
export type DiscoveredPostsResponse = ResponseBody<'listDiscoveredPosts'>;
export type PlatformSyncStatus = Schemas['AnalyticsPlatformSyncStatus'];
export type AnalyticsSyncStatus = ResponseBody<'getAnalyticsSyncStatus'>;
export type TriggerAnalyticsSyncResponse = ResponseBody<'triggerAnalyticsSync'>;

export type GenerateCaptionRequest = RequestBody<'generateCaption'>;
export type RefineCaptionRequest = RequestBody<'refineCaption'>;
export type CaptionResponse = ResponseBody<'generateCaption'>;
export type GenerateImageRequest = RequestBody<'generateImage'>;
export type GenerateImageResponse = ResponseBody<'generateImage'>;
export type ImageJob = ResponseBody<'getImageJob'>;

export type InboxStatus = Schemas['InboxStatus'];
export const INBOX_STATUSES = ['UNREAD', 'READ', 'DONE'] as const satisfies readonly InboxStatus[];

export type InboxChannelAccess = Schemas['InboxChannelAccess'];
export const INBOX_CHANNEL_ACCESS = [
  'AVAILABLE',
  'RECONNECT_REQUIRED',
  'UNSUPPORTED',
] as const satisfies readonly InboxChannelAccess[];

export const INBOX_LIST_MAX_LIMIT = 100;
export const INBOX_LIST_DEFAULT_LIMIT = 25;
export const INBOX_STATUS_MAX_IDS = 100;
export const INBOX_LIST_MAX_ACCOUNTS = 50;

export type InboxListQuery = QueryParams<'listInboxMentions'>;
export type InboxCommentsQuery = QueryParams<'listInboxComments'>;
export type InboxReviewsQuery = QueryParams<'listInboxReviews'>;

export type InboxPerson = Schemas['InboxPerson'];
export type InboxComment = Schemas['InboxComment'];
export type InboxCommentsResponse = ResponseBody<'listInboxComments'>;
export type InboxPage = Pick<InboxCommentsResponse, 'total' | 'hasMore' | 'nextCursor'>;
export type InboxCommentThread = ResponseBody<'getInboxComment'>;
export type InboxMention = Schemas['InboxMention'];
export type InboxMentionsResponse = ResponseBody<'listInboxMentions'>;
export type InboxConversation = Schemas['InboxConversation'];
export type InboxConversationsResponse = ResponseBody<'listInboxConversations'>;
export type InboxMessage = Schemas['InboxMessage'];
export type InboxConversationThread = ResponseBody<'getInboxConversation'>;
export type SentInboxMessage = ResponseBody<'sendInboxMessage'>;
export type InboxReview = Schemas['InboxReview'];
export type InboxReviewsResponse = ResponseBody<'listInboxReviews'>;
export type InboxSummary = ResponseBody<'getInboxSummary'>;
export type InboxSummaryAccount = NonNullable<InboxSummary['accounts']>[number];
export type InboxRefreshResponse = ResponseBody<'refreshInbox'>;

export type InboxTextRequest = Schemas['InboxReplyRequest'];
export type InboxStatusRequest = Schemas['InboxStatusUpdateRequest'];
export type InboxCommentsStatusResponse = ResponseBody<'updateInboxCommentsStatus'>;
export type InboxMentionsStatusResponse = ResponseBody<'updateInboxMentionsStatus'>;
export type InboxConversationsStatusResponse = ResponseBody<'updateInboxConversationsStatus'>;
export type InboxReviewsStatusResponse = ResponseBody<'updateInboxReviewsStatus'>;
