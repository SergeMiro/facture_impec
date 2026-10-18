// Draws the ribbon and manifest icons (docs/OFFICE.md §2: 16, 32 and 80 px required, 64 for
// HighResolutionIconUrl) into public/assets. Run: pnpm addin:icons.
import { mkdirSync, writeFileSync } from 'node:fs';
import { iconPng } from './icon';

const SIZES = [16, 32, 64, 80];
const OUT = new URL('../public/assets/', import.meta.url);

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) writeFileSync(new URL(`icon-${size}.png`, OUT), iconPng(size));
console.log(`icons: ${SIZES.join(', ')} px → apps/addin/public/assets`);
