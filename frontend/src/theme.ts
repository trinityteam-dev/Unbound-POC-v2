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
  // Dark workspace. Canvas (base) < surface (cards) so cards lift off it.
  canvas: '#121316',
  surface: '#1C1D21',
  hairline: 'rgba(255,255,255,.09)',
  textPrimary: '#E7E9EC',
  textSecondary: '#A6ABB3',
  textTertiary: '#71767E',
  primaryGreen: '#0D9488', // brand teal (solid fills: timeline, buttons)
  primaryTint: 'rgba(45,212,191,.16)', // active timeline-node fill on dark
  accent: '#F59E0B', // amber — active/current indicators
  accentTeal: '#2DD4BF', // brighter teal for text/links/active on dark
  segBg: 'rgba(255,255,255,.06)', // segmented-control track
  segActive: 'rgba(255,255,255,.13)', // segmented-control active chip
  amberTint: 'rgba(245,158,11,.12)', // amber row-tint (rows needing review)
  neutralFill: 'rgba(255,255,255,.10)', // upcoming timeline node
  success: '#34D399',
  warn: '#FBBF24',
  danger: '#F87171',
  // Shadows are faint on dark — borders carry most of the separation.
  shadowCard: '0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.28)',
  shadowCardHover: '0 6px 20px rgba(0,0,0,.4)',
} as const
