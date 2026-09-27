import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', () => ({
  generateCaption: vi.fn(),
  refineCaption: vi.fn(),
  generateImage: vi.fn(),
  getImageJob: vi.fn(),
  createUploadUrls: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { registerAiCommands, normalizeAspectRatio, normalizeCaptionPlatform } = await import('../../src/commands/ai.js');
const { initOutput } = await import('../../src/core/output.js');

const workspace = mkdtempSync(join(tmpdir(), 'adaptlypost-cli-ai-'));

let written: string[] = [];

const run = (argv: string[]): Promise<unknown> => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('--json').option('-q, --quiet');
  registerAiCommands(program);
  return program.parseAsync(argv, { from: 'user' });
};

const stdout = (): string => written.join('');
const stdoutJson = (): Record<string, unknown> => JSON.parse(stdout()) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADAPTLYPOST_JSON', '');
  written = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  initOutput({ isTTY: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ai caption', () => {
  it('writes the caption alone to a pipe so it feeds post create -t -', async () => {
    vi.mocked(client.generateCaption).mockResolvedValue({ caption: 'Shipping the CLI today.' });

    await run(['ai', 'caption', '--prompt', 'announce the launch', '--platform', 'x']);

    expect(client.generateCaption).toHaveBeenCalledWith({ prompt: 'announce the launch', platform: 'TWITTER' });
    expect(stdout()).toBe('Shipping the CLI today.\n');
  });

  it('prints the JSON document under --json', async () => {
    vi.mocked(client.generateCaption).mockResolvedValue({ caption: 'Hi' });

    await run(['ai', 'caption', '--prompt', 'hello', '--json']);

    expect(stdoutJson()).toEqual({ ok: true, command: 'ai.caption', data: { caption: 'Hi' } });
  });

  it('rewrites a caption with --refine and --partial', async () => {
    vi.mocked(client.refineCaption).mockResolvedValue({ caption: 'Shorter.' });

    await run(['ai', 'caption', '--prompt', 'make it shorter', '--refine', 'A long caption', '--partial', 'Short']);

    expect(client.refineCaption).toHaveBeenCalledWith({
      prompt: 'make it shorter',
      platform: undefined,
      originalText: 'A long caption',
      partialText: 'Short',
    });
    expect(client.generateCaption).not.toHaveBeenCalled();
  });

  it('refuses a missing prompt, --partial without --refine and an unknown platform', async () => {
    await expect(run(['ai', 'caption'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['ai', 'caption', '--prompt', 'x', '--partial', 'y'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['ai', 'caption', '--prompt', 'x', '--platform', 'myspace'])).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(client.generateCaption).not.toHaveBeenCalled();
  });
});

describe('ai image', () => {
  it('queues an image and returns the job without waiting', async () => {
    vi.mocked(client.generateImage).mockResolvedValue({ jobId: 'job_1', sessionId: 's_1', status: 'queued' });

    await run(['ai', 'image', '--prompt', 'a lighthouse', '--aspect', '16x9', '--model', 'Premium', '--quality', 'high']);

    expect(client.generateImage).toHaveBeenCalledWith({
      prompt: 'a lighthouse',
      aspectRatio: '16:9',
      model: 'premium',
      quality: 'HIGH',
    });
    expect(client.getImageJob).not.toHaveBeenCalled();
    expect(stdoutJson()).toMatchObject({ command: 'ai.image', data: { jobId: 'job_1', status: 'queued' } });
  });

  it('waits for the job and downloads it with -o', async () => {
    vi.mocked(client.generateImage).mockResolvedValue({ jobId: 'job_2', sessionId: 's_1', status: 'queued' });
    vi.mocked(client.getImageJob).mockResolvedValue({
      jobId: 'job_2',
      sessionId: 's_1',
      status: 'completed',
      imageUrl: 'https://cdn.example.test/job_2.png',
      imageId: 'img_1',
      error: null,
    });
    const fetchMock = vi.fn(async () => new Response('PNG', { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);

    await run(['ai', 'image', '--prompt', 'a lighthouse', '-o', `${workspace}/`]);

    const saved = join(workspace, 'job_2.png');
    expect(readFileSync(saved, 'utf8')).toBe('PNG');
    expect(stdoutJson()).toMatchObject({ command: 'ai.image', data: { status: 'completed' }, meta: { savedTo: saved } });
  });

  it('exits 1 with the job error when generation failed', async () => {
    vi.mocked(client.getImageJob).mockResolvedValue({
      jobId: 'job_3',
      sessionId: 's_1',
      status: 'failed',
      imageUrl: null,
      imageId: null,
      error: 'Prompt was rejected',
    });

    await expect(run(['ai', 'image', 'get', 'job_3', '--wait'])).rejects.toMatchObject({
      exitCode: 1,
      message: 'Prompt was rejected',
    });
  });

  it('reads a job without waiting through image get', async () => {
    vi.mocked(client.getImageJob).mockResolvedValue({
      jobId: 'job_4',
      sessionId: 's_1',
      status: 'generating',
      imageUrl: null,
      imageId: null,
      error: null,
    });

    await run(['ai', 'image', 'get', 'job_4']);

    expect(client.getImageJob).toHaveBeenCalledTimes(1);
    expect(stdoutJson()).toMatchObject({ command: 'ai.image', data: { status: 'generating' } });
  });

  it('refuses more than five reference images and bad enums before sending', async () => {
    const references = Array.from({ length: 6 }, (_value, index) => ['--reference', `https://cdn/r${index}.png`]).flat();
    await expect(run(['ai', 'image', '--prompt', 'x', ...references])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['ai', 'image', '--prompt', 'x', '--aspect', '7:3'])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['ai', 'image'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.generateImage).not.toHaveBeenCalled();
  });

  it('passes remote reference images through untouched', async () => {
    vi.mocked(client.generateImage).mockResolvedValue({ jobId: 'job_5', sessionId: 's_1', status: 'queued' });

    await run(['ai', 'image', '--prompt', 'x', '--reference', 'https://cdn/r.png']);

    expect(client.createUploadUrls).not.toHaveBeenCalled();
    expect(client.generateImage).toHaveBeenCalledWith({ prompt: 'x', referenceImages: ['https://cdn/r.png'] });
  });
});

describe('enum helpers', () => {
  it('accepts the forms people type', () => {
    expect(normalizeCaptionPlatform('linkedin')).toBe('LINKEDIN');
    expect(normalizeAspectRatio('4x5')).toBe('4:5');
  });
});
