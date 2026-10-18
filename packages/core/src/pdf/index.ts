// Factur-X PDF, a separate entry (`@fi/core/pdf`): pdf-lib and fontkit weigh about 600 KB, so the
// add-in loads this with `await import('@fi/core/pdf')` when the user asks for a PDF.
export {
  FACTUR_X_FILE,
  type FacturXContent,
  type FacturXOptions,
  FacturXPdfError,
  readFacturXPdf,
  toFacturXPdf,
} from './facturx';
export { frDate, frDecimal, frMoney, frPrice } from './format';
