import { describe, expect, it } from 'vitest';
import { allowedPage } from './pages';

describe('pages opened outside Excel', () => {
  it('opens Stripe Checkout and the customer portal', () => {
    expect(allowedPage('https://checkout.stripe.com/c/pay/cs_test_a1', false)).toBe(true);
    expect(allowedPage('https://billing.stripe.com/p/session/test_a1', false)).toBe(true);
  });

  it('refuses any other page, and the local stand-in outside development', () => {
    for (const url of [
      'https://checkout.stripe.com.example.net/c/pay',
      'http://checkout.stripe.com/c/pay',
      'https://example.net/?https://checkout.stripe.com',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(allowedPage(url, true), url).toBe(false);
    }
    expect(allowedPage('http://localhost:4010/stripe/checkout/cs_1', false)).toBe(false);
    expect(allowedPage('http://localhost:4010/stripe/checkout/cs_1', true)).toBe(true);
  });
});

describe('Google’s window (R5)', () => {
  const api = 'https://api.facture-impec.fr/';
  it('opens only the first page of the window, on our API', () => {
    expect(
      allowedPage('https://api.facture-impec.fr/connectors/google/begin?ticket=a.b', false, api),
    ).toBe(true);
    for (const url of [
      'https://api.facture-impec.fr/connectors/google/callback?code=x',
      'https://evil.example/connectors/google/begin?ticket=a.b',
      'https://accounts.google.com/o/oauth2/v2/auth',
    ]) {
      expect(allowedPage(url, false, api), url).toBe(false);
    }
    expect(allowedPage('https://api.facture-impec.fr/connectors/google/begin', false)).toBe(false);
  });
});
