import { useState } from 'react'
import { Box, Center, Paper, Skeleton, Stack, Text } from '@mantine/core'
import type { JobDetail } from '../api/types'
import { tokens } from '../theme'
import { Step1 } from './step1/Step1'
import {
  DEFAULT_STEP2_TAB,
  WorkspaceHeader,
  type Step2Tab,
} from './WorkspaceHeader'

// Step 2 cards are still placeholders until Phase 5.
const STEP2_CARDS: Record<Step2Tab, string[]> = {
  'Reconciliation & Queries': [
    'Metric strip',
    'Bank Transaction Reconciliation',
    'Client Queries',
    'Reviewer Final sign-off',
  ],
  'Lead Schedules': [
    'Cash Lead Schedule',
    'Cash Verification Checks',
    'Securities Portfolio Valuation',
    'MXT Registry Check',
    'ATO Tax Reconciliation Ledger',
    'Member TSB',
  ],
  Compliance: ['Document Audit Checklist Verification', 'Notes board'],
  'Agent Logs': ['Agent Execution Logs'],
}

export interface WorkspaceProps {
  job: JobDetail | undefined
  isLoading: boolean
  activeStep: 1 | 2
}

export function Workspace({ job, isLoading, activeStep }: WorkspaceProps) {
  const [subTab, setSubTab] = useState<Step2Tab>(DEFAULT_STEP2_TAB)

  if (isLoading) {
    return (
      <Stack p="lg" gap="md">
        <Skeleton height={120} radius="md" />
        <Skeleton height={320} radius="md" />
      </Stack>
    )
  }

  if (!job) {
    return (
      <Center h="100%" p="xl">
        <Stack align="center" gap={4}>
          <Text fw={500} c={tokens.textSecondary}>
            No fund selected
          </Text>
          <Text size="sm" c={tokens.textTertiary}>
            Pick a job from the sidebar to get started.
          </Text>
        </Stack>
      </Center>
    )
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <WorkspaceHeader
        job={job}
        activeStep={activeStep}
        subTab={subTab}
        onSubTabChange={setSubTab}
      />

      <Box style={{ flex: 1, overflowY: 'auto', background: tokens.canvas }} p="xl">
        {activeStep === 1 ? (
          <Step1 job={job} />
        ) : (
          <Stack gap="lg">
            <Text size="sm" c={tokens.textTertiary}>
              Phase 2 shell — Step 2 content lands in Phase 5. Cards to render here ({subTab}):
            </Text>
            {STEP2_CARDS[subTab].map((card) => (
              <Paper
                key={card}
                radius="lg"
                p={28}
                style={{
                  background: tokens.surface,
                  border: `1px solid ${tokens.hairline}`,
                  boxShadow: tokens.shadowCard,
                }}
              >
                <Text fz={15.5} fw={600} c={tokens.textPrimary}>
                  {card}
                </Text>
                <Text size="sm" c={tokens.textTertiary} mt={6}>
                  Placeholder
                </Text>
              </Paper>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  )
}
