import { createTheme, type MantineColorsTuple } from '@mantine/core'

// SuperRecords-aligned palette. Brand green primary #00AF5A at index 6,
// with peach as the warm accent and navy chrome (see global.css).
const brand: MantineColorsTuple = [
  '#e7f7ef',
  '#c2ecd6',
  '#92ddb6',
  '#5fcd94',
  '#33c078',
  '#13b766',
  '#00af5a', // 6 — primary (brand green)
  '#009a4f',
  '#0c6630', // 8 — dark green text on light
  '#08491f',
]

// Peach accent, anchored on #FFBC7D at index 4 with deeper ochre for text/icons.
const accent: MantineColorsTuple = [
  '#fff6ec',
  '#ffe8cf',
  '#ffd6a8',
  '#ffc78c',
  '#ffbc7d', // 4 — brand peach
  '#f0a157',
  '#e0871f', // 6 — readable peach-ochre on light
  '#bf7016',
  '#94560f',
  '#6b3d09',
]

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: 'Poppins, sans-serif',
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

// Structural design tokens — now backed by the theme-aware CSS variables
// defined in global.css (spec §10). Reading `tokens.surface` etc. resolves to
// `var(--sf)`, so every consumer automatically follows the light/dark toggle.
// Legacy names are kept (mapped to the closest spec token) so existing
// components don't need touching.
export const tokens = {
  // Sidebar (charcoal panel).
  sidebarBg: 'var(--pn)',
  sidebarText: 'var(--s1)',
  sidebarTextMuted: 'var(--s2)',
  sidebarTextFaint: 'var(--s3)',
  sidebarActiveBg: 'var(--tn)',
  // Workspace surfaces.
  canvas: 'var(--bg)',
  surface: 'var(--sf)',
  strip: 'var(--st)', // footer / strip background
  field: 'var(--fd)', // input background
  hairline: 'var(--ln)',
  border2: 'var(--l2)',
  textPrimary: 'var(--i1)',
  textSecondary: 'var(--i2)',
  textTertiary: 'var(--i3)',
  textFaint: 'var(--i4)',
  primaryGreen: 'var(--tf)', // brand teal fill (buttons)
  primaryTint: 'var(--tn)', // teal active tint
  accent: 'var(--am)', // amber — active/current indicators
  accentTeal: 'var(--tl)', // teal text/links/active
  blue: 'var(--bl)', // processor / read-only evidence
  violet: 'var(--vi)', // configuration (playbook)
  segBg: 'var(--hv)',
  segActive: 'var(--l2)',
  amberTint: 'var(--at)', // amber draft tint
  neutralFill: 'var(--l2)', // legacy (retired timeline)
  accentBorder: 'var(--ab)', // details-pane accent border
  scrollThumb: 'var(--sc)',
  success: 'var(--gr)',
  warn: 'var(--yl)',
  danger: 'var(--rd)',
  // Shadows are faint on dark — borders carry most of the separation.
  shadowCard: '0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.28)',
  shadowCardHover: '0 6px 20px rgba(0,0,0,.4)',
} as const
