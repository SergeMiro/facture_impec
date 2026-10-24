import { getViteConfig } from 'astro/config';

// Runs tests through Astro's Vite config so astro:env and .astro imports resolve.
export default getViteConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
