import { Box, Group, Text, UnstyledButton } from '@mantine/core'
import type { AuditorNote, JobDetail } from '../../api/types'
import type { ReconView } from './ReconciliationScreen'
import { tokens } from '../../theme'

// Job-level summary, persistent above the tab row across all phase-2 tabs
// (spec §0.3 rejected boxed KPI tiles — this is a flat, de-boxed readout).
// Each metric is clickable and routes to the tab that owns its detail.
export interface FundTotalsProps {
  job: JobDetail
  onGoRecon: (view: ReconView, acct: string | null) => void
  onGoCompliance: () => void
}

function Metric({
  value,
  label,
  color,
  onClick,
}: {
  value: number
  label: string
  color?: string
  onClick: () => void
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      className="hover-row"
      style={{ borderRadius: 6, padding: '2px 8px' }}
    >
      <Group gap={5} wrap="nowrap">
        <Text fz={12.5} fw={600} c={color ?? tokens.textPrimary} className="tabular-nums">
          {value}
        </Text>
        <Text fz={12.5} c={tokens.textSecondary}>
          {label}
        </Text>
      </Group>
    </UnstyledButton>
  )
}

function Dot() {
  return (
    <Text component="span" fz={12} c={tokens.textFaint} style={{ userSelect: 'none' }}>
      ·
    </Text>
  )
}

export function FundTotals({ job, onGoRecon, onGoCompliance }: FundTotalsProps) {
  const p2 = job.phase2_context
  const accounts = Object.values(p2?.reconciliation_results ?? {})

  let total = 0
  let matched = 0
  for (const a of accounts) {
    total += a.transactions.length
    matched += a.transactions.filter((t) => t.status === 'matched').length
  }
  const unmatched = total - matched

  const queries = p2?.queries ?? []
  const pending = queries.filter((q) => q.status === 'pending')
  const firstPending = pending[0]
  const firstPendingAcct = firstPending?.transactions[0]?.account_number ?? null

  const exceptions = Array.isArray(job.auditor_notes)
    ? (job.auditor_notes as AuditorNote[]).length
    : 0

  return (
    <Box
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 16px',
        background: tokens.strip,
        borderBottom: `1px solid ${tokens.hairline}`,
      }}
    >
      <Text
        fz={10}
        fw={700}
        mr={4}
        style={{ letterSpacing: 0.7, textTransform: 'uppercase', color: tokens.textFaint }}
      >
        Fund totals
      </Text>
      <Metric value={total} label="transactions" onClick={() => onGoRecon('all', null)} />
      <Dot />
      <Metric
        value={matched}
        label="matched"
        color={tokens.success}
        onClick={() => onGoRecon('matched', null)}
      />
      <Dot />
      <Metric
        value={unmatched}
        label="unmatched"
        color={tokens.warn}
        onClick={() => onGoRecon('unmatched', null)}
      />
      <Dot />
      <Metric
        value={pending.length}
        label="queries pending"
        onClick={() =>
          firstPending
            ? onGoRecon(`q:${firstPending.id}`, firstPendingAcct)
            : onGoRecon('all', null)
        }
      />
      <Dot />
      <Metric
        value={exceptions}
        label="exceptions"
        color={exceptions > 0 ? tokens.danger : undefined}
        onClick={onGoCompliance}
      />
    </Box>
  )
}
