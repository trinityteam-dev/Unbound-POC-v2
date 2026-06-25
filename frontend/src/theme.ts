import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Teal Graphite palette (Direction C). Teal primary #0D9488 at index 6,
// with amber as the accent.
const brand: MantineColorsTuple = [
  '#e6f6f4',
  '#c0ebe6',
  '#8edcd4',
  '#56c9bd',
  '#2bb4a6',
  '#14a392',
  '#0d9488', // 6 — primary
  '#0b7c72',
  '#09635b',
  '#064842',
]

// Amber accent, anchored on #F59E0B at index 6.
const accent: MantineColorsTuple = [
  '#fff8ec',
  '#fde7c3',
  '#fbd494',
  '#f9bf5e',
  '#f7ab33',
  '#f6a019',
  '#f59e0b', // 6 — accent
  '#d4850a',
  '#a86808',
  '#7c4d06',
]

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: 'Inter, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  colors: { brand, accent },
  fontSizes: {
    xs: '12px',
    sm: '14px',
    md: '15px',
    lg: '17px',
    xl: '20px',
  },
  headings: {
    sizes: {
      h1: { fontSize: '28px', fontWeight: '600' },
      h2: { fontSize: '22px', fontWeight: '600' },
      h3: { fontSize: '18px', fontWeight: '600' },
    },
  },
})

// Structural design tokens (Teal Graphite). Cool graphite neutrals on a
// graphite sidebar; amber reserved as the accent.
// NOTE: `primaryGreen` is the legacy token name kept for component stability —
// it now holds the active *primary* colour (teal) so the timeline/buttons
// follow the theme. `accent` holds amber.
export const tokens = {
  // Charcoal sidebar — neutral warm-black; lets teal + amber pop.
  sidebarBg: '#18181B',
  sidebarText: 'rgba(255,255,255,.95)',
  sidebarTextMuted: 'rgba(255,255,255,.64)',
  sidebarTextFaint: 'rgba(255,255,255,.46)',
  sidebarActiveBg: 'rgba(255,255,255,.08)',
  // Slightly more tinted canvas so white cards lift off it.
  canvas: '#EDF1F1',
  surface: '#FFFFFF',
  hairline: '#E2E8E8',
  textPrimary: '#16212B',
  textSecondary: '#4A5763',
  textTertiary: '#8B97A1',
  primaryGreen: '#0D9488', // primary (teal)
  primaryTint: '#E1F2F0',
  accent: '#F59E0B', // amber — active/current indicators
  // Deeper elevation so cards read as raised.
  shadowCard: '0 1px 3px rgba(22,33,43,.06), 0 4px 12px rgba(22,33,43,.08)',
  shadowCardHover: '0 2px 6px rgba(22,33,43,.08), 0 10px 24px rgba(22,33,43,.12)',
} as const
