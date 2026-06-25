import { useState } from 'react'
import { Box, Center, Skeleton, Stack, Text } from '@mantine/core'
import type { JobDetail } from '../api/types'
import { tokens } from '../theme'
import { Step1 } from './step1/Step1'
import { Step2 } from './step2/Step2'
import { DEFAULT_STEP2_TAB, WorkspaceHeader, type Step2Tab } from './WorkspaceHeader'

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
        {activeStep === 1 ? <Step1 job={job} /> : <Step2 job={job} subTab={subTab} />}
      </Box>
    </Box>
  )
}
