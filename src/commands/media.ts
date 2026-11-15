import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { Readable } from 'node:stream';

import type { Command } from 'commander';

import { createUploadUrls } from '../api/client.js';
import type { UploadMimeType, UploadUrl } from '../api/types.js';
import {
  CliError,
  ExitCode,
  dim,
  green,
  hint,
  isMachine,
  isQuiet,
  networkError,
  print,
  printResult,
  spinner,
  usageError,
  validationError,
  type Spinner,
} from '../core/index.js';
import {
  SNIFF_BYTES,
  isDocumentMimeType,
  maxBytesFor,
  sniffMimeType,
  unsupportedMediaHint,
  uploadFileName,
} from './media-kind.js';

export {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  maxBytesFor,
  sniffMimeType,
} from './media-kind.js';

export const MAX_FILES_PER_REQUEST = 20;
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 20;

export interface PreparedFile {
  path: string;
  fileName: string;
  mimeType: UploadMimeType;
  size: number;
}

export interface UploadedFile {
  fileName: string;
  mimeType: UploadMimeType;
  size: number;
  key: string;
  publicUrl: string;
  expiresAt: string;
}

export interface UploadOptions {
  concurrency: string | number;
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
};

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export const expiresIn = (expiresAt: string | undefined, now: Date = new Date()): string => {
  if (expiresAt === undefined) return 'unknown';

  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return 'unknown';

  const minutes = Math.max(0, Math.round((expiry.getTime() - now.getTime()) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};

export const parseConcurrency = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONCURRENCY) {
    throw usageError(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }
  return parsed;
};

const readHead = async (path: string): Promise<Buffer> => {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

export const prepareFile = async (path: string): Promise<PreparedFile> => {
  const absolute = resolvePath(path);

  const stats = await stat(absolute).catch(() => null);
  if (stats === null) throw usageError(`Cannot read ${path}`);
  if (!stats.isFile()) throw usageError(`${path} is not a file`);
  if (stats.size === 0) throw usageError(`${path} is empty`);

  const head = await readHead(absolute);
  const mimeType = sniffMimeType(head, absolute);
  if (mimeType === undefined) {
    throw validationError(`${path} is not a supported media file`, null, unsupportedMediaHint(head));
  }

  const limit = maxBytesFor(mimeType);
  if (stats.size > limit) {
    throw validationError(
      `${path} is ${formatBytes(stats.size)}, over the ${formatBytes(limit)} limit for ${mimeType}`,
    );
  }

  return {
    path: absolute,
    fileName: uploadFileName(basename(absolute), mimeType),
    mimeType,
    size: stats.size,
  };
};

export const prepareFiles = async (paths: readonly string[]): Promise<PreparedFile[]> => {
  if (paths.length === 0) throw usageError('Pass at least one file');

  const prepared: PreparedFile[] = [];
  for (const path of paths) {
    prepared.push(await prepareFile(path));
  }
  return prepared;
};

const requestUploadUrls = async (files: readonly PreparedFile[]): Promise<UploadUrl[]> => {
  const urls: UploadUrl[] = [];

  for (const batch of chunk(files, MAX_FILES_PER_REQUEST)) {
    const response = await createUploadUrls({
      files: batch.map((file) => ({ fileName: file.fileName, mimeType: file.mimeType })),
    });

    if (response.urls.length !== batch.length) {
      throw new CliError(
        `The API returned ${response.urls.length} upload urls for ${batch.length} files`,
        { exitCode: ExitCode.GENERIC },
      );
    }

    urls.push(...response.urls);
  }

  return urls;
};

const putFile = async (
  file: PreparedFile,
  target: UploadUrl,
  onProgress: (bytes: number) => void,
): Promise<void> => {
  if (!target.uploadUrl.startsWith('https://')) {
    throw new CliError(`Refusing to upload ${file.fileName} to a non-https url`, {
      exitCode: ExitCode.GENERIC,
    });
  }

  const stream = createReadStream(file.path);
  stream.on('data', (piece: string | Buffer) => {
    onProgress(typeof piece === 'string' ? Buffer.byteLength(piece) : piece.length);
  });

  let response: Response;

  try {
    response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(file.size),
      },
      body: Readable.toWeb(stream),
      duplex: 'half',
    });
  } catch (error) {
    stream.destroy();
    throw networkError(`Upload of ${file.fileName} failed`, error);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim().slice(0, 300);
    throw new CliError(
      `Upload of ${file.fileName} failed with ${response.status}${detail === '' ? '' : `: ${detail}`}`,
      {
        exitCode: ExitCode.GENERIC,
        hint:
          response.status === 403
            ? 'the presigned url signs the mime type; re-run so the url matches the file'
            : undefined,
      },
    );
  }
};

const runPool = async <T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  let next = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
};

const runUpload = async (paths: string[], options: UploadOptions): Promise<void> => {
  const files = await prepareFiles(paths);
  const concurrency = parseConcurrency(options.concurrency ?? DEFAULT_CONCURRENCY);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const progress: Spinner | null =
    isQuiet() || isMachine() ? null : spinner('Requesting upload urls…');

  let targets: UploadUrl[] = [];
  let uploaded = 0;

  try {
    targets = await requestUploadUrls(files);

    await runPool(files, concurrency, async (file, index) => {
      await putFile(file, targets[index], (bytes) => {
        uploaded += bytes;
        progress?.update(
          `Uploading ${formatBytes(uploaded)} of ${formatBytes(totalBytes)} · ${Math.min(
            100,
            Math.round((uploaded / totalBytes) * 100),
          )}%`,
        );
      });
    });
  } finally {
    progress?.stop();
  }

  const uploads: UploadedFile[] = files.map((file, index) => ({
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    key: targets[index].key,
    publicUrl: targets[index].publicUrl,
    expiresAt: targets[index].expiresAt,
  }));

  if (isMachine()) {
    printResult('media.upload', uploads, { total: uploads.length, hasMore: false });
    return;
  }

  const nameWidth = Math.max(...uploads.map((upload) => upload.fileName.length));
  const typeWidth = Math.max(...uploads.map((upload) => upload.mimeType.length));

  for (const upload of uploads) {
    print(
      `${green('✓')} ${upload.fileName.padEnd(nameWidth)}  ${upload.mimeType.padEnd(
        typeWidth,
      )}  ${formatBytes(upload.size).padStart(9)}  ${upload.publicUrl}`,
    );
  }

  print();
  print(
    `${uploads.length} ${uploads.length === 1 ? 'file' : 'files'} · ${formatBytes(
      totalBytes,
    )} · urls expire in ${expiresIn(uploads[0]?.expiresAt)}`,
  );
  const document = uploads.find((upload) => isDocumentMimeType(upload.mimeType));
  hint(
    document === undefined
      ? `use them: adaptlypost post create -t "…" -P TWITTER ${uploads
          .map((upload) => `-m ${upload.publicUrl}`)
          .join(' ')}`
      : `use it: adaptlypost post create -t "…" -P LINKEDIN -a <linkedin account> --type DOCUMENT -m ${document.publicUrl}`,
  );
};

const runUrls = async (paths: string[]): Promise<void> => {
  const files = await prepareFiles(paths);
  const progress = isQuiet() || isMachine() ? null : spinner('Requesting upload urls…');

  let targets: UploadUrl[] = [];

  try {
    targets = await requestUploadUrls(files);
  } finally {
    progress?.stop();
  }

  if (isMachine()) {
    printResult('media.urls', targets, { total: targets.length, hasMore: false });
    return;
  }

  targets.forEach((target, index) => {
    print(target.fileName);
    print(`  mimeType   ${files[index].mimeType}`);
    print(`  uploadUrl  ${target.uploadUrl}`);
    print(`  publicUrl  ${target.publicUrl}`);
    print(`  key        ${target.key}`);
    print(`  expiresAt  ${target.expiresAt}`);
  });

  print();
  print(
    `${targets.length} ${targets.length === 1 ? 'url' : 'urls'} · expires in ${expiresIn(
      targets[0]?.expiresAt,
    )}`,
  );
  print(dim('PUT each file with its exact mimeType as Content-Type, or the signature fails.'));
};

export const registerMediaCommands = (program: Command): void => {
  const media = program.command('media').description('upload media for posts');

  media
    .command('upload <files...>')
    .description('mint presigned urls, upload the files and print their public urls')
    .option(
      '--concurrency <n>',
      `parallel uploads, 1..${MAX_CONCURRENCY}`,
      String(DEFAULT_CONCURRENCY),
    )
    .action(async (files: string[], options: UploadOptions) => {
      await runUpload(files, options);
    });

  media
    .command('urls <files...>')
    .description('mint presigned upload urls only, for scripts that upload themselves')
    .action(async (files: string[]) => {
      await runUrls(files);
    });
};
