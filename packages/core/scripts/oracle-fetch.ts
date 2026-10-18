// Downloads the oracle files we may not commit (docs/research/FORMATS.md §5.3, F1 and F3) into
// packages/core/.oracle-cache/ and checks each one against its pinned sha256. Idempotent: files
// already present with the right hash are not downloaded again.
// Run: pnpm --filter @fi/core oracle:fetch
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE = fileURLToPath(new URL('../.oracle-cache/', import.meta.url));

const UBL = 'https://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/';
const FACTURX =
  'https://raw.githubusercontent.com/akretion/factur-x/8b549890ca51085eaf26d71085be2af478249839/src/facturx/xsd_and_schematron/facturx-en16931/';

interface Pinned {
  /** Path under .oracle-cache/. */
  path: string;
  url: string;
  sha256: string;
}

const ubl = (file: string, sha256: string): Pinned => ({
  path: `ubl-2.1/${file}`,
  url: UBL + file,
  sha256,
});
const facturx = (file: string, sha256: string): Pinned => ({
  path: `facturx-1.09.2-en16931/${file}`,
  url: FACTURX + file,
  sha256,
});

/** Hashes taken on 2026-10-17 from the first download. */
export const PINNED: readonly Pinned[] = [
  ubl(
    'maindoc/UBL-Invoice-2.1.xsd',
    '40fae8cb436f3a9506d7acce65ba162caef3b0bed4d5cbc0992b2153ded4edf4',
  ),
  ubl(
    'maindoc/UBL-CreditNote-2.1.xsd',
    'a54651b1225052f811bf2ba01346f13f2454e7cc3e0be290c91dd680dc7b7b1a',
  ),
  ubl(
    'common/CCTS_CCT_SchemaModule-2.1.xsd',
    'dd546e4809df86b6445589f69f0d6c9df162840ae386574ddfc1da7638103e15',
  ),
  ubl(
    'common/UBL-CommonAggregateComponents-2.1.xsd',
    '939172ad8dd057cd403e7f763f6532184dd5ed4b9de24c42ebb35db4792ba613',
  ),
  ubl(
    'common/UBL-CommonBasicComponents-2.1.xsd',
    'bd4ad043ee1d9da1c7f8018dabf739cfafdfb59143d0d16b9ef769e6b7c408a7',
  ),
  ubl(
    'common/UBL-CommonExtensionComponents-2.1.xsd',
    'ad7a4e490978adfbcfc5ec0bb20941cf11ac960ccf0c4de8791a7c731a8dbe87',
  ),
  ubl(
    'common/UBL-CommonSignatureComponents-2.1.xsd',
    '3db472305f029bba5c1ae157bfd0178f715c3f9b94bd8e6c557dbce5e88da874',
  ),
  ubl(
    'common/UBL-CoreComponentParameters-2.1.xsd',
    '8be3379dbdcbcc7802fafdd16bac72c48fff1c0bb364213a31a17911dd06100b',
  ),
  ubl(
    'common/UBL-ExtensionContentDataType-2.1.xsd',
    'fcee77a11870208e6377ea6311b9f2a050bca24bdad8606ea02d71e9f9e72f8d',
  ),
  ubl(
    'common/UBL-QualifiedDataTypes-2.1.xsd',
    '7dcb156e610239c97ae70940cf4653b88e48c3595bf5f56a2204a32e2893e6cf',
  ),
  ubl(
    'common/UBL-SignatureAggregateComponents-2.1.xsd',
    '17bb6b62d709b4fd81449a37655af36aa6a1276ad4fdb1b2e249a5ed4b7c2172',
  ),
  ubl(
    'common/UBL-SignatureBasicComponents-2.1.xsd',
    'cef924d7ba3d1d8ade14469325cde1364f8c174e46f0198ec02da8e9e748a489',
  ),
  ubl(
    'common/UBL-UnqualifiedDataTypes-2.1.xsd',
    '09052d406b4293e2a5f9c2bfee6df10ad4d8d5f0b36e24a6349d7f7936d89eb6',
  ),
  ubl(
    'common/UBL-XAdESv132-2.1.xsd',
    'a4f726bcf8cc3f7d9ffa4dab99e005535a8e8b60dced1e5d94578d2e05afa96e',
  ),
  ubl(
    'common/UBL-XAdESv141-2.1.xsd',
    '1fa4625e9cefcb7a9abb5ac1b64315547450031eece8a55bd584e4ba4b79dbc1',
  ),
  ubl(
    'common/UBL-xmldsig-core-schema-2.1.xsd',
    '101909c9f06456d61ddcc4fb982f1d40dc357b439f393b1a2eb46e42acd60809',
  ),
  facturx(
    'Factur-X_EN16931.xsd',
    '977654a4e0442885a3d622ca198cff414f467eebc93098654b98127f2349f066',
  ),
  facturx(
    'Factur-X_1.09_EN16931_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
    '5a3ce756cfa8d4f2ff3165d68123cfb7fbf3c7b64664edb0de38cca64d5c413b',
  ),
  facturx(
    'Factur-X_1.09_EN16931_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
    '99ee1a2a2857babcb4ab74a64fc65a816fe25d2209291d403a8d0dc85542abd8',
  ),
  facturx(
    'Factur-X_1.09_EN16931_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
    'f87a1b78d2b7177955957002f8c2a7917e326038d38803f875266cc7579ea857',
  ),
  facturx(
    'FACTUR-X_EN16931.xslt',
    '979f7e0210c727f1049ff55a93498531ba83a8ed2207d0d5247cd2d80c9c3d1a',
  ),
  facturx(
    'FACTUR-X_EN16931_codedb.xml',
    '70339a41d71b02bb97683f8eea04acbd764e077a88a446b32860d89c3351b62f',
  ),
];

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Downloads what is missing or stale; returns the number of files downloaded. */
export async function fetchOracleFiles(): Promise<number> {
  let downloaded = 0;
  for (const file of PINNED) {
    const target = CACHE + file.path;
    if (existsSync(target) && sha256(readFileSync(target)) === file.sha256) continue;
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== file.sha256) {
      throw new Error(`${file.url}: sha256 ${actual}, expected ${file.sha256}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    downloaded++;
  }
  return downloaded;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = await fetchOracleFiles();
  console.info(`.oracle-cache: ${count} file(s) downloaded, ${PINNED.length} checked`);
}
