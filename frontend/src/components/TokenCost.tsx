import { Text } from '@mantine/core'
import { formatCost } from '../api/format'
import type { TokenUsage } from '../api/types'
import { tokens as t } from '../theme'

// Header token/cost badge — mirrors the old UI (job total cost, total tokens,
// per-phase breakdown). Renders nothing when the job has no usage data.
export function TokenCost({ usage }: { usage?: TokenUsage | null }) {
  const jobTotal = usage?.job_total
  const cost = formatCost(usage)
  if (!jobTotal || cost == null) return null

  const phaseParts = Object.entries(usage?.phases ?? {})
    .filter(([, v]) => v && v.cost_usd != null)
    .map(([phase, v]) => {
      const label = phase === 'phase1' ? 'P1' : phase === 'phase2' ? 'P2' : phase
      return `${label} $${v.cost_usd.toFixed(3)}`
    })

  return (
    <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
      <Text fz={13} fw={600} c={t.textPrimary} className="tabular-nums">
        Cost {cost}
      </Text>
      {jobTotal.total_tokens != null && (
        <Text fz={11} c={t.textTertiary} className="tabular-nums">
          {jobTotal.total_tokens.toLocaleString()} tokens
        </Text>
      )}
      {phaseParts.length > 0 && (
        <Text fz={11} c={t.textTertiary} className="tabular-nums">
          {phaseParts.join(' · ')}
        </Text>
      )}
    </div>
  )
}
