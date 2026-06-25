import type { ReactNode } from 'react'
import { Box, Paper, Text } from '@mantine/core'
import { tokens } from '../../theme'

// Per-section border accents — colored card outlines that differentiate
// section types at a glance (teal = data, amber = attention, blue = action,
// violet = config). Tuned for the dark theme.
export type CardAccent = 'teal' | 'amber' | 'blue' | 'violet' | 'neutral'

const ACCENT_BORDER: Record<CardAccent, string> = {
  teal: 'rgba(45,212,191,0.40)',
  amber: 'rgba(245,158,11,0.42)',
  blue: 'rgba(96,165,250,0.42)',
  violet: 'rgba(167,139,250,0.42)',
  neutral: 'rgba(255,255,255,0.13)',
}

// Standard content card — flat dark surface + accent border + soft shadow.
export function Card({
  title,
  titleColor,
  subtitle,
  action,
  accent = 'neutral',
  children,
}: {
  title: string
  titleColor?: string
  subtitle?: string
  action?: ReactNode
  accent?: CardAccent
  children: ReactNode
}) {
  return (
    <Paper
      radius="lg"
      p={24}
      style={{
        background: tokens.surface,
        border: `1px solid ${ACCENT_BORDER[accent]}`,
        boxShadow: tokens.shadowCard,
      }}
    >
      <Box
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: subtitle ? 4 : 16,
        }}
      >
        <Text fz={15.5} fw={600} c={titleColor ?? tokens.textPrimary}>
          {title}
        </Text>
        {action}
      </Box>
      {subtitle && (
        <Text fz={12.5} c={tokens.textTertiary} mb="md">
          {subtitle}
        </Text>
      )}
      {children}
    </Paper>
  )
}
