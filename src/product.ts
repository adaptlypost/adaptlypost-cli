export const PRODUCT = {
  id: 'adaptlypost',
  displayName: 'AdaptlyPost',
  binName: 'adaptlypost',
  altBinName: 'apost',
  npmPackage: '@adaptlypost/cli',
  envPrefix: 'ADAPTLYPOST',
  defaultApiUrl: 'https://post.adaptlypost.com/post/api/v1',
  appUrl: 'https://app.adaptlypost.com',
  tokensUrl: 'https://app.adaptlypost.com/api-tokens',
  tokenPrefixes: ['adaptly_'],
  verifyPath: '/social-accounts',
} as const;
