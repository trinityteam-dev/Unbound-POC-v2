import type { ReactNode } from 'react'
import { Box, Group, Text, UnstyledButton } from '@mantine/core'
import { tokens } from '../../theme'

// Filter-rail primitives (spec §6). The rail is FILTERS ONLY — never navigation.
// Stable shape: grouped flat lists. Selecting an item filters the table; it does
// not highlight in place.

export function RailShell({ children }: { children: ReactNode }) {
  return (
    <Box
      className="scroll-accent"
      style={{
        width: 168,
        flexShrink: 0,
        overflowY: 'auto',
        borderRight: `1px solid ${tokens.hairline}`,
        padding: '14px 12px 14px 16px',
      }}
    >
      {children}
    </Box>
  )
}

export function RailGroupLabel({
  label,
  count,
  scope,
  mt,
}: {
  label: string
  count?: number | string
  scope?: string
  mt?: number
}) {
  return (
    <Text
      mt={mt}
      mb={6}
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
        color: tokens.textFaint,
      }}
      truncate
    >
      {label}
      {count != null ? ` · ${count}` : ''}
      {scope ? ` · ${scope}` : ''}
    </Text>
  )
}

export function RailDivider() {
  return <Box style={{ borderTop: `1px solid ${tokens.hairline}`, margin: '12px 0' }} />
}

export interface RailItemProps {
  label: string
  count?: ReactNode
  active?: boolean
  dotColor?: string
  countColor?: string
  onClick: () => void
}

// Slim single-line row: optional dot · label · count. Active = teal bold + amber
// left edge tick (no fill); hover = faint tint.
export function RailItem({
  label,
  count,
  active,
  dotColor,
  countColor,
  onClick,
}: RailItemProps) {
  return (
    <UnstyledButton
      onClick={onClick}
      className="hover-row"
      style={{
        display: 'block',
        width: '100%',
        borderRadius: 6,
        padding: '5px 7px 5px 8px',
        borderLeft: `2px solid ${active ? tokens.accent : 'transparent'}`,
        background: active ? tokens.primaryTint : undefined,
      }}
    >
      <Group gap={7} wrap="nowrap">
        {dotColor && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: dotColor,
              flexShrink: 0,
            }}
          />
        )}
        <Text
          fz={12.5}
          fw={active ? 600 : 500}
          c={active ? tokens.accentTeal : tokens.textSecondary}
          truncate
          style={{ flex: 1, minWidth: 0 }}
        >
          {label}
        </Text>
        {count != null && (
          <Text
            fz={11.5}
            fw={500}
            c={countColor ?? (active ? tokens.accentTeal : tokens.textTertiary)}
            className="tabular-nums"
            style={{ flexShrink: 0 }}
          >
            {count}
          </Text>
        )}
      </Group>
    </UnstyledButton>
  )
}
