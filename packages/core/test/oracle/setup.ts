// Vitest globalSetup of the oracle project: fetch the pinned files, compile the stylesheets.
import { fetchOracleFiles } from '../../scripts/oracle-fetch';
import { STYLESHEETS, type Stylesheet } from './paths';
import { ensureSef } from './sef';

export default async function setup() {
  await fetchOracleFiles();
  for (const name of Object.keys(STYLESHEETS) as Stylesheet[]) ensureSef(name);
}
