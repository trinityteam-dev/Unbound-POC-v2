import { Badge, Box, Group, Text } from '@mantine/core'
import type { JobDetail } from '../api/types'
import { statusMeta } from '../lib/status'
import { tokens } from '../theme'
import { TokenCost } from './TokenCost'
import { WorkflowTimeline } from './WorkflowTimeline'

// Persistent header band (spec §4): identity & status / timeline / sub-tabs.
// Sub-tabs (Row 3) appear only on Step 2 — mirrors the existing IA, where
// Step 1 has no sub-tabs and Step 2 has 4 (switchDiTab).
export const STEP2_TABS = [
  'Reconciliation & Queries',
  'Lead Schedules',
  'Compliance',
  'Agent Logs',
] as const
export type Step2Tab = (typeof STEP2_TABS)[number]

export interface WorkspaceHeaderProps {
  job: JobDetail
  activeStep: 1 | 2
  subTab: Step2Tab
  onSubTabChange: (tab: Step2Tab) => void
}

export function WorkspaceHeader({
  job,
  activeStep,
  subTab,
  onSubTabChange,
}: WorkspaceHeaderProps) {
  const meta = statusMeta[job.status]

  return (
    <Box
      style={{
        background: tokens.surface,
        borderBottom: `1px solid ${tokens.hairline}`,
      }}
      px="xl"
      pt="lg"
    >
      {/* Row 1 — identity & status */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fz={18} fw={600} c={tokens.textPrimary}>
            {job.fund_name}
          </Text>
          {job.abn ? (
            <Text fz={12.5} c={tokens.textTertiary} mt={2}>
              ABN {job.abn}
            </Text>
          ) : null}
        </div>
        <Group gap="lg" wrap="nowrap" align="flex-start">
          <TokenCost usage={job.token_usage} />
          <Badge color={meta.color} variant="light" radius="sm" size="md">
            {meta.label}
          </Badge>
        </Group>
      </Group>

      {/* Row 2 — workflow timeline */}
      <Box py="xl" px="md">
        <WorkflowTimeline status={job.status} progressPercent={job.progress_percent} />
      </Box>

      {/* Row 3 — secondary sub-tabs (Step 2 only) — segmented control */}
      {activeStep === 2 ? (
        <Box pb="md">
          <Box
            style={{
              display: 'inline-flex',
              gap: 2,
              background: tokens.segBg,
              borderRadius: 10,
              padding: 4,
            }}
          >
            {STEP2_TABS.map((tab) => {
              const active = tab === subTab
              return (
                <button
                  key={tab}
                  onClick={() => onSubTabChange(tab)}
                  className={active ? undefined : 'subtab-seg'}
                  style={{
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: '7px 14px',
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: active ? 600 : 500,
                    background: active ? tokens.segActive : 'transparent',
                    color: active ? tokens.accentTeal : tokens.textSecondary,
                    boxShadow: 'none',
                    transition: 'color 120ms ease',
                  }}
                >
                  {tab}
                </button>
              )
            })}
          </Box>
        </Box>
      ) : (
        <Box h={8} />
      )}
    </Box>
  )
}

export const DEFAULT_STEP2_TAB: Step2Tab = STEP2_TABS[0]
