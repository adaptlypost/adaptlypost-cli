import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';

import {
  CliError,
  ExitCode,
  PRODUCT,
  httpStatusToExitCode,
  resolveProfile,
  resolveLanguage,
  usageError,
  userAgent,
} from '../core/index.js';

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'];
const TIMEOUT_MS = 120_000;

const collect = (value: string, previous: string[]): string[] => [...previous, value];

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseQuery(pairs: string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index <= 0) {
      throw usageError(
        `--query expects key=value, got "${pair}".`,
        `${PRODUCT.binName} api /social-posts --query limit=5 --query statuses=DRAFT`,
      );
    }
    params.append(pair.slice(0, index), pair.slice(index + 1));
  }
  return params;
}

function parseHeaders(pairs: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf(':');
    if (index <= 0) throw usageError(`--header expects "Name: value", got "${pair}".`);
    const name = pair.slice(0, index).trim();
    if (name.toLowerCase() === 'authorization') {
      throw usageError(
        'Authorization comes from the resolved profile and cannot be overridden.',
        'Use --token or --profile to change which token is sent.',
      );
    }
    headers[name] = pair.slice(index + 1).trim();
  }
  return headers;
}

async function resolveBody(
  data: string | undefined,
  dataFile: string | undefined,
  method: string,
): Promise<string | undefined> {
  if (data !== undefined && dataFile !== undefined) {
    throw usageError('Pass either --data or --data-file, not both.');
  }

  let raw: string | undefined;
  if (dataFile !== undefined) {
    raw = dataFile === '-' ? await readStdin() : await readFile(dataFile, 'utf8');
  } else if (data !== undefined) {
    if (data === '@-') raw = await readStdin();
    else if (data.startsWith('@')) raw = await readFile(data.slice(1), 'utf8');
    else raw = data;
  } else if (method !== 'GET' && method !== 'HEAD' && !process.stdin.isTTY) {
    const piped = await readStdin();
    raw = piped.trim() === '' ? undefined : piped;
  }

  if (raw === undefined) return undefined;
  try {
    JSON.parse(raw);
  } catch {
    throw usageError('The request body is not valid JSON.');
  }
  return raw;
}

export function registerApiCommand(program: Command): void {
  program
    .command('api')
    .argument('<path>', 'API path such as /social-posts, or an HTTP method when a path follows')
    .argument('[pathAfterMethod]', 'API path, when the first argument is an HTTP method')
    .description(`send an authenticated request to the ${PRODUCT.displayName} API`)
    .option('-X, --method <method>', 'HTTP method', 'GET')
    .option('-q, --query <key=value>', 'query parameter, repeat the key for arrays', collect, [])
    .option('-d, --data <json|@file>', 'request body, @- reads stdin')
    .option('--data-file <path>', 'request body read from a file, - reads stdin')
    .option('-H, --header <name:value>', 'extra request header, repeatable', collect, [])
    .option('-i, --include', 'print the status and response headers to stderr')
    .action(
      async (
        first: string,
        second: string | undefined,
        options: {
          method: string;
          query: string[];
          data?: string;
          dataFile?: string;
          header: string[];
          include?: boolean;
        },
      ) => {
        let method = options.method.toUpperCase();
        let path = first;

        if (second !== undefined) {
          if (!METHODS.includes(first.toUpperCase())) {
            throw usageError(`"${first}" is not an HTTP method.`, `Methods: ${METHODS.join(', ')}`);
          }
          method = first.toUpperCase();
          path = second;
        }
        if (!METHODS.includes(method)) {
          throw usageError(`"${options.method}" is not an HTTP method.`, `Methods: ${METHODS.join(', ')}`);
        }
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
          throw usageError(
            'api takes a path, not a URL.',
            `This CLI only ever talks to the resolved API host. Try: ${PRODUCT.binName} api /social-posts`,
          );
        }

        const profile = resolveProfile();
        const search = parseQuery(options.query).toString();
        const url = `${profile.apiUrl}${path.startsWith('/') ? path : `/${path}`}${search ? `?${search}` : ''}`;
        const body = await resolveBody(options.data, options.dataFile, method);
        const language = resolveLanguage();

        const headers: Record<string, string> = {
          Accept: 'application/json',
          'User-Agent': userAgent(PRODUCT.id),
          ...parseHeaders(options.header),
          Authorization: `Bearer ${profile.token}`,
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (language) headers['x-language'] = language;

        let response: Response;
        try {
          response = await fetch(url, {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          throw new CliError(
            `Could not reach ${profile.apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
            { exitCode: ExitCode.NETWORK, cause: error },
          );
        }

        if (options.include) {
          process.stderr.write(`HTTP ${response.status} ${response.statusText}\n`);
          for (const [name, value] of [...response.headers].sort()) {
            process.stderr.write(`${name}: ${value}\n`);
          }
          process.stderr.write('\n');
        }

        const text = await response.text();

        if (!response.ok) {
          let message = `${method} ${path} failed with ${response.status}`;
          let details: unknown = null;
          try {
            const parsed = JSON.parse(text) as { message?: unknown };
            details = parsed;
            if (Array.isArray(parsed.message)) message = parsed.message.join('; ');
            else if (typeof parsed.message === 'string') message = parsed.message;
          } catch {
            if (text.trim() !== '') message = text.trim();
          }
          throw new CliError(message, {
            exitCode: httpStatusToExitCode(response.status),
            details,
          });
        }

        if (text === '') return;

        let out = text;
        if (process.stdout.isTTY) {
          try {
            out = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            out = text;
          }
        }
        process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
      },
    );
}
