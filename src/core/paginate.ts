import { usageError } from './errors.js';
import { warn } from './output.js';

export const MAX_PAGES = 50;

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface PageResult<T> {
  items: T[];
  total?: number;
  hasMore?: boolean;
}

export interface PaginateOptions<T> {
  fetchPage: (page: PageRequest) => Promise<PageResult<T>>;
  pageSize: number;
  offset?: number;
  maxPages?: number;
  onPage?: (items: T[], page: { index: number; offset: number; total?: number }) => void | Promise<void>;
  collect?: boolean;
  quiet?: boolean;
}

export interface PaginateResult<T> {
  items: T[];
  total?: number;
  pages: number;
  fetched: number;
  truncated: boolean;
}

export function validateLimit(value: number | string | undefined, min: number, max: number, flag = '--limit'): number {
  if (value === undefined) return max;
  const limit = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(limit) || limit < min || limit > max) {
    throw usageError(`${flag} must be an integer between ${min} and ${max}`);
  }
  return limit;
}

export function validateOffset(value: number | string | undefined, flag = '--offset'): number {
  if (value === undefined) return 0;
  const offset = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    throw usageError(`${flag} must be an integer of 0 or more`);
  }
  return offset;
}

export async function paginateAll<T>(options: PaginateOptions<T>): Promise<PaginateResult<T>> {
  const maxPages = options.maxPages ?? MAX_PAGES;
  const collect = options.collect !== false;
  const items: T[] = [];
  let offset = options.offset ?? 0;
  let pages = 0;
  let fetched = 0;
  let total: number | undefined;
  let truncated = false;

  while (pages < maxPages) {
    const page = await options.fetchPage({ limit: options.pageSize, offset });
    pages += 1;
    fetched += page.items.length;
    if (page.total !== undefined) total = page.total;
    if (collect) items.push(...page.items);
    await options.onPage?.(page.items, { index: pages - 1, offset, total: page.total });

    offset += page.items.length;

    if (page.items.length === 0) break;
    if (page.hasMore === false) break;
    if (page.hasMore === undefined) {
      if (page.items.length < options.pageSize) break;
      if (total !== undefined && offset >= total) break;
    }
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
  }

  if (truncated && !options.quiet) {
    warn(`stopped after ${maxPages} requests (${fetched} items). Continue with --offset ${offset}`);
  }

  return { items, total, pages, fetched, truncated };
}
