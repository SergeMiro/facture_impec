# Product demonstration

The homepage plays a silent, 36-second product film. Motion provides the editable animation source under its MIT license.
The source page is `/demo-film`. Its robots metadata excludes it from indexing.
The homepage uses native video playback and does not load Motion.

The film uses sample data and simulated actions. It makes no API requests and sends no invoices.
The story covers a missing amount, confirmed correction, confirmed Factur-X send, returned statuses, and a recorded payment.
Payment collection and compressed status timings are not presented as live operations.

## Playback

The player selects a portrait video below 640 pixels. Both videos use H.264 without an audio track.
Playback starts when the player becomes visible. It pauses outside the viewport or when the tab becomes hidden.
A manual pause remains in effect when the visitor scrolls back.
Reduced motion disables automatic playback. The play button remains available.

French captions, chapter buttons, replay, native controls, and a text transcript provide alternate navigation.
If a video fails, the player points to the transcript and existing interactive demonstration.

## Update the film

Requirements: Node, pnpm, local Google Chrome, FFmpeg, and ffprobe.
The renderer only accepts localhost URLs. Browser evidence is marked `browser: local`.

1. Edit `apps/site/src/content/demo-film.ts` or `apps/site/src/components/film/`.
2. Format the source with Biome before rendering.
3. Start the isolated local server:

   ```bash
   pnpm --filter @fi/site exec tsx scripts/serve-demo.ts
   ```

4. In another terminal, render both videos:

   ```bash
   pnpm --filter @fi/site demo:render
   ```

5. Run the checks:

   ```bash
   pnpm --filter @fi/site test:e2e
   pnpm verify --concurrency=1
   pnpm build
   ```

6. Commit the source, videos, posters, captions, and manifest together.

The renderer records local Chrome, trims initialization, and encodes both variants.
Each video is less than 2 MB in this version.
The manifest records codec, dimensions, duration, media hashes, and a source fingerprint.
Unit tests reject stale source or modified media. Source changes require another render.
Deployment uses the existing marketing-site procedure in `RUNBOOK.md`.

References: [Motion](https://motion.dev/), [browser autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).
