import { APIConnectionError, APIError, APITimeoutError } from '@adaptlypost/sdk';

import { ApiError, networkError } from '../core/errors.js';

export class FetchFailure extends Error {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : 'FetchFailure';
    this.url = url;
  }
}

export function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('x-requestid') ?? headers.get('request-id') ?? undefined;
}

function failedUrl(error: APIConnectionError): string | undefined {
  return error.cause instanceof FetchFailure ? error.cause.url : undefined;
}

export function toCliError(error: unknown, timeoutMs: number): unknown {
  if (error instanceof APITimeoutError) {
    const target = failedUrl(error) ?? 'the API';
    return networkError(`Request to ${target} timed out after ${Math.round(timeoutMs / 1000)}s`, error);
  }
  if (error instanceof APIConnectionError) {
    return networkError(error.message, error, 'Check your network connection, a proxy, or --api-url');
  }
  if (error instanceof APIError) {
    return new ApiError({
      status: error.status,
      body: error.body,
      requestId: requestIdOf(error.headers),
      method: error.method,
      path: error.path,
      cause: error,
    });
  }
  return error;
}
