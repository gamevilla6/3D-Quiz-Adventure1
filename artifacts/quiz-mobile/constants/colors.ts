/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#17243B',
    tint: '#4C78E8',
    background: '#F1F4F8',
    foreground: '#17243B',
    card: '#FFFFFF',
    cardForeground: '#17243B',
    cardBorder: 'rgba(255,255,255,0.9)',
    primary: '#4C78E8',
    primaryForeground: '#FFFFFF',
    primaryLight: '#9CB5F6',
    primaryLine: 'rgba(76,120,232,0.42)',
    primarySurface: '#EDF2FF',
    secondary: '#E9EEF7',
    secondaryForeground: '#34435B',
    muted: '#E9EDF3',
    mutedForeground: '#78869A',
    accent: '#EDF2FF',
    accentForeground: '#345ECB',
    destructive: '#E88174',
    destructiveForeground: '#FFFFFF',
    border: '#E4E9F0',
    input: '#E4E9F0',
    mint: '#49B89D',
    mintLine: 'rgba(73,184,157,0.48)',
    mintSurface: '#EFFAF6',
    coral: '#E88174',
    coralLine: '#EFAAA2',
    coralSurface: '#FFF5F3',
    gold: '#E9BD70',
    eyebrow: '#607BA7',
    artSurface: '#F0F5FF',
    surfaceSubtle: '#F7F9FC',
    progressTrack: '#E9EDF3',
    shadow: '#293E64',
  },
  dark: {
    text: '#F1F4FB',
    tint: '#88A5F4',
    background: '#111827',
    foreground: '#F1F4FB',
    card: '#1B2638',
    cardForeground: '#F1F4FB',
    cardBorder: 'rgba(255,255,255,0.12)',
    primary: '#88A5F4',
    primaryForeground: '#15213A',
    primaryLight: '#B4C6FA',
    primaryLine: 'rgba(136,165,244,0.42)',
    primarySurface: '#253451',
    secondary: '#263247',
    secondaryForeground: '#E4EAF5',
    muted: '#273247',
    mutedForeground: '#A0AEC2',
    accent: '#253451',
    accentForeground: '#B4C6FA',
    destructive: '#F1998E',
    destructiveForeground: '#281817',
    border: '#354258',
    input: '#354258',
    mint: '#6CD2B7',
    mintLine: 'rgba(108,210,183,0.45)',
    mintSurface: '#1D3A38',
    coral: '#F1998E',
    coralLine: '#8E5D5B',
    coralSurface: '#3A292C',
    gold: '#E9BD70',
    eyebrow: '#A9BDE5',
    artSurface: '#1E2B42',
    surfaceSubtle: '#222E42',
    progressTrack: '#2C394E',
    shadow: '#070B12',
  },
  radius: 20,
};

export default colors;
