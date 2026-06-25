import { Paper, Text } from '@mantine/core'
import { tokens } from '../../theme'

interface Stat {
  label: string
  value: number
  color?: string
}

export interface MetricStripProps {
  total: number
  matched: number
  unmatched: number
  queries: number
  exceptions: number
}

export function MetricStrip({ total, matched, unmatched, queries, exceptions }: MetricStripProps) {
  const stats: Stat[] = [
    { label: 'Transactions', value: total },
    { label: 'Matched', value: matched, color: tokens.success },
    { label: 'Unmatched', value: unmatched, color: tokens.warn },
    { label: 'Queries', value: queries },
    { label: 'Exceptions', value: exceptions, color: exceptions > 0 ? tokens.danger : undefined },
  ]

  return (
    <Paper
      radius="lg"
      style={{
        background: tokens.surface,
        border: `1px solid rgba(45,212,191,0.40)`,
        boxShadow: tokens.shadowCard,
        display: 'flex',
      }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={{
            flex: 1,
            padding: '18px 24px',
            borderLeft: i > 0 ? `1px solid ${tokens.hairline}` : 'none',
          }}
        >
          <Text fz={12.5} c={tokens.textTertiary}>
            {s.label}
          </Text>
          <Text fz={26} fw={600} c={s.color ?? tokens.textPrimary} className="tabular-nums" mt={2}>
            {s.value}
          </Text>
        </div>
      ))}
    </Paper>
  )
}
