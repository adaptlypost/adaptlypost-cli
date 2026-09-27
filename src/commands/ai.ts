import { stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve as resolvePath } from 'node:path';

import type { Command } from 'commander';

import { generateCaption, generateImage, getImageJob, refineCaption } from '../api/client.js';
import {
  CAPTION_PLATFORMS,
  IMAGE_ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_QUALITIES,
  type CaptionPlatform,
  type GenerateImageRequest,
  type ImageAspectRatio,
  type ImageJob,
  type ImageModel,
  type ImageQuality,
} from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  envVar,
  formatDuration,
  formatId,
  hint,
  isMachine,
  isQuiet,
  networkError,
  parseDuration,
  printKeyValues,
  printResult,
  spinner,
  success,
  usageError,
} from '../core/index.js';
import { inspectLocalMedia, isRemoteMedia, readStdin, uploadLocalMedia } from './post-input.js';

const MAX_PROMPT_LENGTH = 2000;
const MAX_REFERENCE_IMAGES = 5;
const IMAGE_POLL_INTERVAL_MS = 3_000;
const DEFAULT_IMAGE_TIMEOUT = '3m';
const TERMINAL_IMAGE_STATUSES = new Set(['completed', 'failed']);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const collect = (value: string, previous: string[]): string[] => [...previous, value];

interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
}

interface CaptionOptions extends GlobalOptions {
  prompt?: string;
  platform?: string;
  refine?: string;
  partial?: string;
}

interface ImageWaitOptions extends GlobalOptions {
  wait?: boolean;
  timeout: string;
  output?: string;
}

interface ImageOptions extends ImageWaitOptions {
  prompt?: string;
  aspect?: string;
  model?: string;
  quality?: string;
  reference: string[];
  session?: string;
}

const pickEnum = <T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
  normalize: (raw: string) => string,
): T => {
  const candidate = normalize(value.trim());
  if (!(allowed as readonly string[]).includes(candidate)) {
    throw usageError(`Unknown ${label} "${value}".`, `Expected one of: ${allowed.join(', ')}`);
  }
  return candidate as T;
};

export const normalizeCaptionPlatform = (value: string): CaptionPlatform =>
  pickEnum(value, CAPTION_PLATFORMS, 'platform', (raw) => (raw.toLowerCase() === 'x' ? 'TWITTER' : raw.toUpperCase()));

export const normalizeAspectRatio = (value: string): ImageAspectRatio =>
  pickEnum(value, IMAGE_ASPECT_RATIOS, 'aspect ratio', (raw) => raw.replace(/x/i, ':'));

export const normalizeImageModel = (value: string): ImageModel =>
  pickEnum(value, IMAGE_MODELS, 'model', (raw) => raw.toLowerCase());

export const normalizeImageQuality = (value: string): ImageQuality =>
  pickEnum(value, IMAGE_QUALITIES, 'quality', (raw) => raw.toUpperCase());

const isTruthy = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

const wantsJson = (options: GlobalOptions): boolean =>
  options.json === true || isTruthy(process.env[envVar('JSON')]);

async function readText(value: string, flag: string, maxLength: number): Promise<string> {
  const text = (value === '-' ? await readStdin() : value).trim();
  if (text === '') {
    throw usageError(value === '-' ? `Nothing arrived on stdin for ${flag}.` : `${flag} cannot be empty.`);
  }
  if (text.length > maxLength) {
    throw usageError(`${flag} is ${text.length} characters; the limit is ${maxLength}.`);
  }
  return text;
}

const withProgress = async <T>(label: string, quiet: boolean | undefined, operation: () => Promise<T>): Promise<T> => {
  const progress = quiet || isQuiet() || isMachine() ? null : spinner(label);
  try {
    return await operation();
  } finally {
    progress?.stop();
  }
};

async function runCaption(options: CaptionOptions): Promise<void> {
  if (options.prompt === undefined) {
    throw usageError('--prompt is required.', 'ai caption --prompt "announce the v2 launch" --platform LINKEDIN');
  }
  if (options.partial !== undefined && options.refine === undefined) {
    throw usageError('--partial only applies together with --refine.');
  }
  if (options.prompt === '-' && options.refine === '-') {
    throw usageError('Only one of --prompt and --refine can read stdin.');
  }

  const prompt = await readText(options.prompt, '--prompt', MAX_PROMPT_LENGTH);
  const platform = options.platform === undefined ? undefined : normalizeCaptionPlatform(options.platform);

  const response =
    options.refine === undefined
      ? await withProgress('Writing caption…', options.quiet, () => generateCaption({ prompt, platform }))
      : await (async () => {
          const originalText = await readText(options.refine as string, '--refine', 10_000);
          const partialText = options.partial === undefined ? undefined : options.partial;
          return withProgress('Rewriting caption…', options.quiet, () =>
            refineCaption({ prompt, platform, originalText, ...(partialText ? { partialText } : {}) }),
          );
        })();

  if (wantsJson(options)) {
    printResult('ai.caption', response);
    return;
  }

  process.stdout.write(response.caption.endsWith('\n') ? response.caption : `${response.caption}\n`);
}

async function resolveReferences(references: string[], quiet: boolean | undefined): Promise<string[]> {
  if (references.length > MAX_REFERENCE_IMAGES) {
    throw usageError(`At most ${MAX_REFERENCE_IMAGES} reference images, got ${references.length}.`);
  }

  for (const reference of references) {
    if (isRemoteMedia(reference)) continue;
    const media = await inspectLocalMedia(reference);
    if (!media.mimeType.startsWith('image/')) {
      throw new CliError(`${reference} is not an image; reference images must be JPEG, PNG or WebP.`, {
        exitCode: ExitCode.VALIDATION,
      });
    }
  }

  if (references.every(isRemoteMedia)) return references;

  const uploaded = await withProgress('Uploading reference images…', quiet, () => uploadLocalMedia(references));
  return references.map((reference) => uploaded.get(reference) ?? reference);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

function timeoutOf(value: string): number {
  const ms = parseDuration(value);
  if (ms === null || ms <= 0) {
    throw usageError(`--timeout must be a duration such as 3m, got "${value}".`);
  }
  return ms;
}

export async function waitForImage(jobId: string, timeoutMs: number, quiet?: boolean): Promise<ImageJob> {
  const startedAt = Date.now();
  const progress = quiet || isQuiet() || isMachine() ? null : spinner('Generating image…');

  try {
    for (;;) {
      const job = await getImageJob(jobId);
      if (TERMINAL_IMAGE_STATUSES.has(job.status)) return job;

      if (Date.now() - startedAt >= timeoutMs) {
        throw networkError(
          `Timed out after ${formatDuration(timeoutMs)} with the image still ${job.status}.`,
          undefined,
          `Check it later: ${PRODUCT.binName} ai image get ${jobId} --wait`,
        );
      }

      progress?.update(`Generating image… ${job.status}, ${formatDuration(Date.now() - startedAt)}`);
      await sleep(IMAGE_POLL_INTERVAL_MS);
    }
  } finally {
    progress?.stop();
  }
}

async function downloadImage(job: ImageJob, output: string): Promise<string> {
  const imageUrl = job.imageUrl as string;

  let response: Response;
  try {
    response = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw networkError(`Could not download ${imageUrl}: ${(error as Error).message}`, error);
  }
  if (!response.ok) {
    throw new CliError(`Downloading ${imageUrl} failed with ${response.status} ${response.statusText}.`, {
      exitCode: ExitCode.GENERIC,
    });
  }

  let path = resolvePath(output);
  const isDirectory = output.endsWith('/') || (await stat(path).then((info) => info.isDirectory()).catch(() => false));
  if (isDirectory) {
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const extension = EXTENSION_BY_TYPE[type] ?? (extname(new URL(imageUrl).pathname) || '.png');
    path = join(path, `${job.jobId}${extension}`);
  }

  try {
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    throw new CliError(`Could not write ${path}: ${(error as Error).message}`, {
      exitCode: ExitCode.GENERIC,
      cause: error,
    });
  }
  return path;
}

async function finishImage(job: ImageJob, options: ImageWaitOptions): Promise<void> {
  if (job.status === 'failed') {
    if (isMachine()) printResult('ai.image', job);
    throw new CliError(job.error ?? 'The image generation failed.', {
      exitCode: ExitCode.GENERIC,
      hint: 'Credits for a failed image are refunded. Adjust the prompt and try again',
    });
  }

  const savedTo = options.output !== undefined && job.imageUrl ? await downloadImage(job, options.output) : undefined;

  if (isMachine()) {
    printResult('ai.image', job, savedTo ? { savedTo } : undefined);
    return;
  }

  success(`Image ready  ${formatId(job.jobId)}`);
  printKeyValues([
    ['url', job.imageUrl ?? '—'],
    ...(savedTo ? [['saved', savedTo] as [string, string]] : []),
    ['session', job.sessionId],
  ]);
}

async function runImage(options: ImageOptions): Promise<void> {
  if (options.prompt === undefined) {
    throw usageError('--prompt is required.', 'ai image --prompt "a lighthouse at dawn, watercolor" --aspect 16:9');
  }

  const timeoutMs = timeoutOf(options.timeout);
  const request: GenerateImageRequest = { prompt: await readText(options.prompt, '--prompt', MAX_PROMPT_LENGTH) };
  if (options.aspect !== undefined) request.aspectRatio = normalizeAspectRatio(options.aspect);
  if (options.model !== undefined) request.model = normalizeImageModel(options.model);
  if (options.quality !== undefined) request.quality = normalizeImageQuality(options.quality);
  if (options.session !== undefined) request.sessionId = options.session;
  if (options.reference.length > 0) {
    request.referenceImages = await resolveReferences(options.reference, options.quiet);
  }

  const queued = await withProgress('Queueing image…', options.quiet, () => generateImage(request));

  if (!options.wait && options.output === undefined) {
    if (isMachine()) {
      printResult('ai.image', queued);
      return;
    }
    success(`Image queued  ${formatId(queued.jobId)}`);
    printKeyValues([
      ['job', queued.jobId],
      ['session', queued.sessionId],
      ['status', queued.status],
    ]);
    hint(`Fetch it with: ${PRODUCT.binName} ai image get ${queued.jobId} --wait -o ./`);
    return;
  }

  await finishImage(await waitForImage(queued.jobId, timeoutMs, options.quiet), options);
}

async function runImageGet(jobId: string, options: ImageWaitOptions): Promise<void> {
  const timeoutMs = timeoutOf(options.timeout);
  const job =
    options.wait || options.output !== undefined
      ? await waitForImage(jobId, timeoutMs, options.quiet)
      : await getImageJob(jobId);

  if (TERMINAL_IMAGE_STATUSES.has(job.status)) {
    await finishImage(job, options);
    return;
  }

  if (isMachine()) {
    printResult('ai.image', job);
    return;
  }

  printKeyValues(
    [
      ['job', job.jobId],
      ['session', job.sessionId],
      ['status', job.status],
    ],
    '',
  );
  hint(`Still ${job.status}. Wait for it with: ${PRODUCT.binName} ai image get ${job.jobId} --wait`);
}

const withWaitOptions = (command: Command): Command =>
  command
    .option('--wait', 'Poll until the image is ready')
    .option('--timeout <duration>', 'How long --wait waits', DEFAULT_IMAGE_TIMEOUT)
    .option('-o, --output <path>', 'Download the finished image to this file or directory; implies --wait');

export function registerAiCommands(program: Command): void {
  const ai = program.command('ai').description('AI captions and images. Uses the workspace credits');

  ai.command('caption')
    .description('Write a caption, or rewrite one with --refine. The caption alone goes to stdout')
    .option('--prompt <text>', `What the caption should say, max ${MAX_PROMPT_LENGTH} characters, or "-" for stdin`)
    .option('--platform <platform>', `Hold the caption to this platform's limit (${CAPTION_PLATFORMS.join(', ')})`)
    .option('--refine <text>', 'Rewrite this caption following --prompt, or "-" for stdin')
    .option('--partial <text>', 'A partly written caption to continue from, with --refine')
    .action(async (_options: CaptionOptions, command: Command) => {
      await runCaption(command.optsWithGlobals() as CaptionOptions);
    });

  const image = withWaitOptions(
    ai
      .command('image')
      .description('Generate an image. Returns a job id; add --wait or -o to get the finished image')
      .option('--prompt <text>', `What to draw, max ${MAX_PROMPT_LENGTH} characters, or "-" for stdin`)
      .option('--aspect <ratio>', `Aspect ratio (${IMAGE_ASPECT_RATIOS.join(', ')})`)
      .option('--model <model>', `Model (${IMAGE_MODELS.join(', ')})`)
      .option('--quality <quality>', `Quality (${IMAGE_QUALITIES.join(', ')})`)
      .option(
        '--reference <path|url>',
        `Reference image to steer the result, repeatable, up to ${MAX_REFERENCE_IMAGES}. Local files are uploaded first`,
        collect,
        [],
      )
      .option('--session <id>', 'Session id from an earlier image, to keep related images together'),
  ).action(async (_options: ImageOptions, command: Command) => {
    await runImage(command.optsWithGlobals() as ImageOptions);
  });

  withWaitOptions(image.command('get <jobId>').description('Read an image job, optionally waiting for it')).action(
    async (jobId: string, _options: ImageWaitOptions, command: Command) => {
      await runImageGet(jobId, { ...command.optsWithGlobals(), ...command.opts() } as ImageWaitOptions);
    },
  );
}
