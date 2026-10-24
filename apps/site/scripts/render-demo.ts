// Render our Motion source into local H.264 assets. browser: local. No remote site or API is opened.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { demoFilm } from '../src/content/demo-film';
import { demoSourceFingerprint } from './demo-source';

const { values } = parseArgs({
  options: { base: { type: 'string', default: 'http://127.0.0.1:4333' } },
});
const base = new URL(values.base ?? 'http://127.0.0.1:4333');
if (!['localhost', '127.0.0.1'].includes(base.hostname))
  throw new Error('The render only opens our local site.');
const out = fileURLToPath(new URL('../public/demo/', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'fi-product-film-'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const variants: Record<
    string,
    {
      file: string;
      sha256: string;
      width: number;
      height: number;
      duration: number;
      codec: string;
      audio: false;
    }
  > = {};
  for (const [variant, width, height] of [
    ['landscape', 1280, 800],
    ['portrait', 960, 1200],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: scratch, size: { width, height } },
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    const started = Date.now();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL('/demo-film', base).toString());
    await page.waitForFunction(() => document.documentElement.dataset.filmReady === 'true');
    const elapsed = Number(await page.locator('.product-film').getAttribute('data-time'));
    const lead = Math.max(0, (Date.now() - started) / 1000 - elapsed);
    await page.waitForFunction(
      (duration) =>
        Number(document.querySelector('.product-film')?.getAttribute('data-time')) >= duration,
      demoFilm.duration,
      { timeout: 50_000 },
    );
    await page.waitForTimeout(200);
    const recording = page.video();
    await context.close();
    if (errors.length) throw new Error(errors.join('\n'));
    if (!recording) throw new Error('No browser recording');
    const movie = join(out, `product-${variant}.mp4`);
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        lead.toFixed(3),
        '-i',
        await recording.path(),
        '-t',
        String(demoFilm.duration),
        '-vf',
        'fps=24,format=yuv420p',
        '-c:v',
        'libx264',
        '-profile:v',
        'main',
        '-level',
        '3.2',
        '-preset',
        'medium',
        '-crf',
        '19',
        '-movflags',
        '+faststart',
        '-an',
        movie,
      ],
      { stdio: 'inherit' },
    );
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        '1.5',
        '-i',
        movie,
        '-frames:v',
        '1',
        '-c:v',
        'libwebp',
        '-quality',
        '86',
        '-update',
        '1',
        join(out, `product-${variant}.webp`),
      ],
      { stdio: 'inherit' },
    );
    const codec = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height',
        '-of',
        'csv=p=0',
        movie,
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split(',');
    const duration = Number(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          movie,
        ],
        { encoding: 'utf8' },
      ).trim(),
    );
    const audio = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        movie,
      ],
      { encoding: 'utf8' },
    ).trim();
    if (
      codec[0] !== 'h264' ||
      Number(codec[1]) !== width ||
      Number(codec[2]) !== height ||
      !Number.isFinite(duration) ||
      Math.abs(duration - demoFilm.duration) > 0.1 ||
      audio
    )
      throw new Error('Encoded movie does not match its delivery contract');
    variants[variant] = {
      file: `product-${variant}.mp4`,
      sha256: createHash('sha256')
        .update(await readFile(movie))
        .digest('hex'),
      width,
      height,
      duration,
      codec: codec[0],
      audio: false,
    };
    console.log(
      `browser: local; ${variant}: ${(await stat(movie)).size} bytes; ${demoFilm.duration} seconds`,
    );
  }
  await writeFile(
    join(out, 'product-manifest.json'),
    `${JSON.stringify({ sourceSha256: await demoSourceFingerprint(), browser: 'local', variants }, null, 2)}\n`,
  );
  const stamp = (value: number) =>
    `00:${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}.000`;
  await writeFile(
    join(out, 'product-fr.vtt'),
    `WEBVTT\n\n${demoFilm.steps.map((step) => `${stamp(step.start)} --> ${stamp(step.end)}\n${step.caption}`).join('\n\n')}\n`,
  );
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
