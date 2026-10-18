import { rmSync } from 'node:fs';
import { E2E_DB } from './env';

export default function teardown(): void {
  rmSync(E2E_DB, { recursive: true, force: true });
}
