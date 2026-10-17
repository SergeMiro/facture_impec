// French identifiers (docs/research/FR_RULES.md Q5).

const digitsOnly = (value: string, length: number) =>
  value.length === length && /^\d+$/.test(value);

/** Standard Luhn: from the right, double every second digit; valid when the sum is a multiple of 10. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const isSirenShape = (value: string) => digitsOnly(value, 9);
export const isSiretShape = (value: string) => digitsOnly(value, 14);

export function isValidSiren(value: string): boolean {
  return isSirenShape(value) && luhn(value);
}

const LA_POSTE = '356000000';

/**
 * SIRET check digit. Some active La Poste establishments fail Luhn (verified in the Sirene register);
 * for them the digit sum must be a multiple of 5 (python-stdnum, not an INSEE text), hence FF-SIRET-01
 * is only a warning.
 */
export function isValidSiret(value: string): boolean {
  if (!isSiretShape(value)) return false;
  if (luhn(value)) return true;
  if (!value.startsWith(LA_POSTE)) return false;
  const digitSum = [...value].reduce((acc, d) => acc + Number(d), 0);
  return digitSum % 5 === 0;
}

export const FR_VAT_SHAPE = /^FR[0-9A-Z]{2}\d{9}$/;

/** Key of a French VAT number: (12 + 3 × (SIREN mod 97)) mod 97, on two digits. */
export function frenchVatKey(siren: string): string {
  return String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0');
}

/**
 * True when a French VAT number has the right numeric key. Letter keys exist (entities without a
 * SIREN) and cannot be checked offline, so they pass.
 */
export function hasValidFrenchVatKey(vatId: string): boolean {
  if (!FR_VAT_SHAPE.test(vatId)) return false;
  const key = vatId.slice(2, 4);
  if (!/^\d{2}$/.test(key)) return true;
  return key === frenchVatKey(vatId.slice(4));
}

/** IBAN structure and ISO 7064 mod 97-10 check. Spaces are not allowed here (FF-FMT-02 handles them). */
export function isValidIban(value: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}
