import type { RequestBody } from '@adaptlypost/sdk';

import {
  DEFAULT_FACEBOOK_IMAGE_LAYOUT,
  DEFAULT_WORDPRESS_POST_STATUS,
  type BulkSchedulePostsRequest,
  type FacebookPostConfig,
  type UpdatePostRequest,
  type WordPressPostConfig,
} from './types.js';

interface PlatformConfigs {
  facebookConfigs?: FacebookPostConfig[];
  wordpressConfigs?: WordPressPostConfig[];
}

function withDefaults<T extends PlatformConfigs>({ facebookConfigs, wordpressConfigs, ...rest }: T) {
  return {
    ...rest,
    facebookConfigs: facebookConfigs?.map((config) => ({
      ...config,
      imageLayout: config.imageLayout ?? DEFAULT_FACEBOOK_IMAGE_LAYOUT,
    })),
    wordpressConfigs: wordpressConfigs?.map((config) => ({
      ...config,
      status: config.status ?? DEFAULT_WORDPRESS_POST_STATUS,
    })),
  };
}

export function withConfigDefaults(updatePostRequest: UpdatePostRequest): RequestBody<'updatePost'> {
  return withDefaults(updatePostRequest);
}

export function withBulkConfigDefaults(
  bulkSchedulePostsRequest: BulkSchedulePostsRequest,
): RequestBody<'bulkSchedulePosts'> {
  return {
    ...withDefaults(bulkSchedulePostsRequest),
    posts: bulkSchedulePostsRequest.posts.map((post) => withDefaults(post)),
  };
}
