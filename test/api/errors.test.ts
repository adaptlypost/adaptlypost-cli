import { APIConnectionError, APIError, APITimeoutError } from '@adaptlypost/sdk';
import { describe, expect, it } from 'vitest';

import { FetchFailure, toCliError } from '../../src/api/errors.js';
import { ApiError, CliError } from '../../src/core/errors.js';
import { ExitCode } from '../../src/core/exit-codes.js';

const URL_TRIED = 'https://post.example.test/post/api/v1/social-posts';

describe('toCliError', () => {
  it('reports a timeout with the url and the seconds waited', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const error = toCliError(
      new APITimeoutError('POST /social-posts timed out after 30000ms', { cause: new FetchFailure(URL_TRIED, timeout) }),
      30_000,
    );

    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) return;
    expect(error.exitCode).toBe(ExitCode.NETWORK);
    expect(error.message).toBe(`Request to ${URL_TRIED} timed out after 30s`);
  });

  it('keeps the SDK message for a connection failure', () => {
    const error = toCliError(new APIConnectionError(`Could not reach ${URL_TRIED}: fetch failed`), 30_000);

    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) return;
    expect(error.exitCode).toBe(ExitCode.NETWORK);
    expect(error.message).toBe(`Could not reach ${URL_TRIED}: fetch failed`);
  });

  it('reads the request id from the alternative header names', () => {
    const error = toCliError(
      new APIError({
        status: 404,
        body: { message: 'Post not found' },
        headers: new Headers({ 'request-id': 'req_7' }),
        method: 'GET',
        path: '/social-posts/post_1',
      }),
      30_000,
    );

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.requestId).toBe('req_7');
    expect(error.exitCode).toBe(ExitCode.NOT_FOUND);
    expect(error.message).toBe('Post not found');
  });

  it('passes anything else through', () => {
    const original = new Error('boom');

    expect(toCliError(original, 30_000)).toBe(original);
  });
});

describe('FetchFailure', () => {
  it('keeps the name and message of what fetch threw', () => {
    const failure = new FetchFailure(URL_TRIED, new TypeError('fetch failed'));

    expect(failure.name).toBe('TypeError');
    expect(failure.message).toBe('fetch failed');
    expect(failure.url).toBe(URL_TRIED);
  });
});
