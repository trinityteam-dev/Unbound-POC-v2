import { useState } from 'react'
import { Box, Button, Center, Skeleton, Stack, Text } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import type { JobDetail } from '../api/types'
import { tokens } from '../theme'
import { FailureView } from './FailureView'
import { Step1 } from './step1/Step1'
import { Step2 } from './step2/Step2'
import { DEFAULT_STEP2_TAB, WorkspaceHeader, type Step2Tab } from './WorkspaceHeader'

export interface WorkspaceProps {
  job: JobDetail | undefined
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
  activeStep: 1 | 2
}

export function Workspace({ job, isLoading, isError, onRetry, activeStep }: WorkspaceProps) {
  const [subTab, setSubTab] = useState<Step2Tab>(DEFAULT_STEP2_TAB)

  if (isLoading) {
    return (
      <Stack p="xl" gap="lg">
        <Skeleton height={120} radius="lg" />
        <Skeleton height={340} radius="lg" />
      </Stack>
    )
  }

  if (isError && !job) {
    return (
      <Center h="100%" p="xl">
        <Stack align="center" gap="sm">
          <IconAlertCircle size={28} color="#DC2626" />
          <Text fw={500} c={tokens.textSecondary}>
            Couldn’t load this job
          </Text>
          {onRetry && (
            <Button variant="light" color="brand" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </Stack>
      </Center>
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
        {job.status === 'failed' ? (
          <FailureView job={job} />
        ) : activeStep === 1 ? (
          <Step1 job={job} />
        ) : (
          <Step2 job={job} subTab={subTab} />
        )}
      </Box>
    </Box>
  )
}
