import type { ReactNode } from 'react'
import { Badge, Box, Group, Text } from '@mantine/core'
import { IconCoins, IconLock, IconSettings } from '@tabler/icons-react'
import type { JobDetail } from '../api/types'
import { formatCost, getModelLabel } from '../api/format'
import { useModels } from '../api/hooks'
import { statusMeta } from '../lib/status'
import { PHASE_LABEL, isPhase2Plus, tabsForStatus, type WorkspaceTab } from '../lib/phase'
import { tokens } from '../theme'

export interface WorkspaceHeaderProps {
  job: JobDetail
  tab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
  onOpenPlaybook: () => void
  // Job-level summary rendered between the identity bar and the tab row.
  summary?: ReactNode
}

// Identity bar (spec §4) + single tab row (spec §5). These regions never move;
// switching jobs/tabs only swaps content inside them.
export function WorkspaceHeader({
  job,
  tab,
  onTabChange,
  onOpenPlaybook,
  summary,
}: WorkspaceHeaderProps) {
  const meta = statusMeta[job.status]
  const tabs = tabsForStatus(job.status)
  const cost = formatCost(job.token_usage)
  const totalTokens = job.token_usage?.job_total?.total_tokens
  const wpLocked = isPhase2Plus(job.status)
  const modelLabel = getModelLabel(useModels().data?.models, job.model)

  return (
    <Box style={{ flexShrink: 0 }}>
      {/* Identity bar */}
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        px={20}
        py={11}
      >
        <Box style={{ minWidth: 0 }}>
          <Group gap={7} wrap="wrap" align="center" style={{ rowGap: 2 }}>
            <Text fz={15} fw={500} c={tokens.textPrimary} lh={1.25}>
              {job.fund_name}
            </Text>
            {modelLabel && (
              <Text
                fz={10}
                fw={600}
                c={tokens.textTertiary}
                style={{
                  background: tokens.strip,
                  border: `1px solid ${tokens.hairline}`,
                  padding: '1px 7px',
                  borderRadius: 999,
                  flexShrink: 0,
                }}
              >
                {modelLabel}
              </Text>
            )}
          </Group>
          <Text fz={11} c={tokens.textTertiary} mt={1} truncate>
            {job.abn ? `ABN ${job.abn} · ` : ''}
            {PHASE_LABEL[job.status]}
          </Text>
        </Box>

        <Group gap={10} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          {cost && (
            <Group
              gap={6}
              wrap="nowrap"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: `1px solid ${tokens.hairline}`,
                background: tokens.strip,
              }}
            >
              <IconCoins size={13} color={tokens.accent} />
              <Text fz={12} fw={600} c={tokens.textPrimary} className="tabular-nums">
                {cost}
              </Text>
              {totalTokens != null && (
                <Text fz={11} c={tokens.textTertiary} className="tabular-nums">
                  · {(totalTokens / 1_000_000).toFixed(2)}M
                </Text>
              )}
            </Group>
          )}

          <button
            onClick={onOpenPlaybook}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 7,
              border: `1px solid var(--vi)`,
              background: 'transparent',
              color: tokens.violet,
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <IconSettings size={14} />
            Playbook
          </button>

          {/* Fixed width so a longer status label never shifts the cost chip /
              Playbook button when switching jobs. */}
          <Badge
            color={meta.color}
            variant="filled"
            radius={999}
            size="md"
            w={150}
            styles={{ root: { justifyContent: 'center' }, label: { overflow: 'visible' } }}
          >
            {meta.label}
          </Badge>
        </Group>
      </Group>

      {/* Job-level summary (fund totals) — persists across all tabs */}
      {summary}

      {/* Single tab row — never wraps (spec §5) */}
      {tabs.length > 0 && (
        <Box
          px={20}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 2,
            borderBottom: `1px solid ${tokens.hairline}`,
            flexWrap: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {tabs.map((t, i) => {
            const active = t === tab
            const showDivider = i === 1 // after Classified Docs
            const locked = t === 'Classified Docs' && wpLocked
            return (
              <Box key={t} style={{ display: 'flex', alignItems: 'stretch' }}>
                {showDivider && (
                  <Box
                    style={{
                      width: 1,
                      alignSelf: 'center',
                      height: 16,
                      background: tokens.hairline,
                      margin: '0 8px',
                    }}
                  />
                )}
                <button
                  onClick={() => onTabChange(t)}
                  className={active ? undefined : 'tab-btn'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '9px 10px',
                    border: 'none',
                    borderBottom: `2px solid ${active ? tokens.accentTeal : 'transparent'}`,
                    marginBottom: -1,
                    background: 'transparent',
                    color: active ? tokens.accentTeal : tokens.textTertiary,
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'color 120ms ease',
                  }}
                >
                  {locked && <IconLock size={12} />}
                  {t}
                </button>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
