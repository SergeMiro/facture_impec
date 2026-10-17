// Brand palette for every surface (site, add-in, PDFs, e-mails). Green is the brand: calm,
// "conforme", money that arrives. Keep this the single source; CSS reads it via the site theme.

export const brand = {
  leaf: {
    50: '#eefaf3',
    100: '#d6f2e2',
    200: '#ade3c6',
    300: '#7bcfa5',
    400: '#47b582',
    500: '#249a66',
    600: '#167c51',
    700: '#126343',
    800: '#104f37',
    900: '#0d402e',
    950: '#05241a',
  },
  cream: '#faf8f2',
  sand: '#efe9da',
  gold: '#c9a85b',
  ink: '#0c1d16',
  muted: '#53665c',
  // Plan §3: test mode is always orange, on every screen.
  testMode: '#f59e0b',
} as const;
