import { Alert, Stack } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { JobDetail } from '../api/types'
import { AgentLogs } from './step2/AgentLogs'

// Shown when a job's status is `failed` — surfaces the error + the raw logs,
// since the Step 2 tabs aren't reachable for a failed job.
export function FailureView({ job }: { job: JobDetail }) {
  return (
    <Stack gap="lg">
      <Alert
        color="red"
        variant="light"
        radius="md"
        icon={<IconAlertTriangle size={18} />}
        title="Audit failed"
      >
        {job.message || 'The pipeline encountered an error during processing.'}
      </Alert>
      <AgentLogs logs={job.logs} />
    </Stack>
  )
}
