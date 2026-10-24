import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { demoSourceFingerprint } from '../../scripts/demo-source';
import { demoFilm } from './demo-film';

describe('published product film', () => {
  it('matches the editable source and intact, silent H.264 assets', async () => {
    const directory = new URL('../../public/demo/', import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL('product-manifest.json', directory), 'utf8'),
    );
    expect(manifest.sourceSha256).toBe(await demoSourceFingerprint());
    expect(manifest.browser).toBe('local');
    for (const [variant, dimensions] of Object.entries({
      landscape: [1280, 800],
      portrait: [960, 1200],
    })) {
      const asset = manifest.variants[variant];
      const bytes = await readFile(new URL(asset.file, directory));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect([asset.width, asset.height]).toEqual(dimensions);
      expect(asset.codec).toBe('h264');
      expect(asset.audio).toBe(false);
      expect(asset.duration).toBeGreaterThan(35.8);
      expect(asset.duration).toBeLessThanOrEqual(36.1);
      expect(bytes.length).toBeLessThan(3_000_000);
    }
  });

  it('provides captions for every chapter without gaps', async () => {
    const captions = await readFile(
      new URL('../../public/demo/product-fr.vtt', import.meta.url),
      'utf8',
    );
    expect(demoFilm.steps[0].start).toBe(0);
    expect(demoFilm.steps.at(-1)?.end).toBe(demoFilm.duration);
    for (const [index, step] of demoFilm.steps.entries()) {
      if (index > 0) expect(demoFilm.steps[index - 1]?.end).toBe(step.start);
      expect(captions).toContain(step.caption);
    }
  });
});
