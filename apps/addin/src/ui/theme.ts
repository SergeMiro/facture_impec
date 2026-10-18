// Fluent UI's light theme in the brand's green (packages/shared/src/brand.ts).
import { brand } from '@fi/shared';
import { type Theme, webLightTheme } from '@fluentui/react-components';

const leaf = brand.leaf;

export const theme: Theme = {
  ...webLightTheme,
  colorBrandBackground: leaf[600],
  colorBrandBackgroundHover: leaf[700],
  colorBrandBackgroundPressed: leaf[800],
  colorBrandBackgroundSelected: leaf[700],
  colorBrandForeground1: leaf[700],
  colorBrandForeground2: leaf[800],
  colorBrandForegroundLink: leaf[700],
  colorBrandForegroundLinkHover: leaf[800],
  colorBrandForegroundLinkPressed: leaf[900],
  colorBrandStroke1: leaf[600],
  colorBrandStroke2: leaf[300],
  colorCompoundBrandBackground: leaf[600],
  colorCompoundBrandBackgroundHover: leaf[700],
  colorCompoundBrandBackgroundPressed: leaf[800],
  colorCompoundBrandForeground1: leaf[600],
  colorCompoundBrandStroke: leaf[600],
  colorCompoundBrandStrokeHover: leaf[700],
  colorNeutralForeground2BrandHover: leaf[700],
  colorNeutralForeground2BrandSelected: leaf[700],
};

/** Plan §3: test mode is orange on every screen. */
export const TEST_ORANGE = brand.testMode;
