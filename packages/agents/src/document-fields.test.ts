import { describe, expect, it } from 'vitest';
import { parseFrenchDate, readFields, sirensIn } from './document-fields';

describe('document fields', () => {
  it('read French dates in their usual shapes, and refuse impossible ones', () => {
    expect(parseFrenchDate('05/03/2026')).toBe('2026-03-05');
    expect(parseFrenchDate('5.3.2026')).toBe('2026-03-05');
    expect(parseFrenchDate('1er mars 2026')).toBe('2026-03-01');
    expect(parseFrenchDate('12 fevrier 2026')).toBe('2026-02-12');
    expect(parseFrenchDate('2026-03-05')).toBe('2026-03-05');
    expect(parseFrenchDate('31/02/2026')).toBe(null);
    expect(parseFrenchDate('12 brumaire 2026')).toBe(null);
  });

  it('take each date after its label only', () => {
    const attestation = readFields(
      'Paris, le 02/01/2026\nATTESTATION DE VIGILANCE\nAttestation délivrée le 12 mars 2026\nCode de sécurité : X',
    );
    expect(attestation.issuedOn).toBe('2026-03-12');
    expect(readFields('Extrait Kbis\nÀ JOUR AU 5 janvier 2026').issuedOn).toBe('2026-01-05');
    expect(readFields('Fait à Saint-Apollinaire, le 03/02/2026').issuedOn).toBe('2026-02-03');
    // A date with no label says nothing.
    expect(readFields('Dijon, 12/03/2026').issuedOn).toBe(null);
  });

  it('read a validity as a period or as its end', () => {
    expect(readFields('Période de validité : du 01/01/2026\nau 31/12/2026 inclus')).toMatchObject({
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    });
    expect(readFields('La présente attestation est valable jusqu’au 30 juin 2027.')).toMatchObject({
      validFrom: null,
      validTo: '2027-06-30',
    });
    expect(readFields('Date d’expiration : 2027-01-31').validTo).toBe('2027-01-31');
    expect(readFields('Période de validité : du 1er janvier au 31 décembre 2026').validTo).toBe(
      '2026-12-31',
    );
  });

  it('read the réception date of a PV', () => {
    expect(
      readFields('La réception des travaux est prononcée avec réserves le 14/09/2026.').receptionOn,
    ).toBe('2026-09-14');
    expect(readFields('Date de réception : 2 octobre 2026').receptionOn).toBe('2026-10-02');
    expect(readFields('Réception avec effet au 30/09/2026').receptionOn).toBe('2026-09-30');
    expect(
      readFields('Le maître d’ouvrage déclare recevoir les travaux le 15 octobre 2026').receptionOn,
    ).toBe('2026-10-15');
    expect(
      readFields('Il prononce la réception des ouvrages à la date du 3 novembre 2026.').receptionOn,
    ).toBe('2026-11-03');
  });

  it('find SIRENs with a valid check digit, from a SIREN, a SIRET or a VAT number, once each', () => {
    const text = [
      'Atelier Dupont SARL, SIRET 100 000 009 00017', // a SIRET: its SIREN
      'RCS Dijon 200 000 008 21000 Dijon', // a SIREN, then the postcode
      'TVA FR37200000008', // the same company again
      'Tél. 03 80 12 34 56 — commande 123 456 789', // a phone, and nine digits failing Luhn
    ].join('\n');
    expect(sirensIn(text)).toEqual(['100000009', '200000008']);
    expect(sirensIn('N° TVA : FR 88 100 000 009')).toEqual(['100000009']);
  });
});
