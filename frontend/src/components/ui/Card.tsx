import type { ReactNode } from 'react'
import { Box, Paper, Text } from '@mantine/core'
import { tokens } from '../../theme'

// Standard white content card — flat surface + hairline + soft shadow (theme).
export function Card({
  title,
  titleColor,
  subtitle,
  action,
  children,
}: {
  title: string
  titleColor?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Paper
      radius="lg"
      p={24}
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.hairline}`,
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
