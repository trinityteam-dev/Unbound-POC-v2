import { useEffect, useState } from 'react'
import { Box, Button, Center, Loader, Stack, Text } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import type { JobDetail, JobFile } from '../api/types'
import {
  defaultTabForStatus,
  jobPhase,
  tabsForStatus,
  type WorkspaceTab,
} from '../lib/phase'
import { tokens } from '../theme'
import { FailureView } from './FailureView'
import { WorkspaceHeader } from './WorkspaceHeader'
import { ReconciliationScreen } from './workspace/ReconciliationScreen'
import { WorkpapersScreen } from './workspace/WorkpapersScreen'
import { WorkspaceFooter } from './workspace/WorkspaceFooter'
import { PlaybookDrawer } from './workspace/PlaybookDrawer'
import { AgentLogs } from './step2/AgentLogs'
import { Compliance } from './step2/Compliance'
import { LeadSchedules } from './step2/LeadSchedules'

export interface WorkspaceProps {
  job: JobDetail | undefined
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
}

// Rounded details pane with a teal accent border (spec §2). Holds the identity
// bar + tab row, the rail+content body, and the pinned phase footer.
function Pane({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: tokens.surface,
        borderRadius: 12,
        border: `1px solid ${tokens.accentBorder}`,
        overflow: 'hidden',
      }}
    >
      {children}
    </Box>
  )
}

export function Workspace({ job, isLoading, isError, onRetry }: WorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>('Reconciliation')
  const [files, setFiles] = useState<JobFile[]>([])
  const [playbookOpen, setPlaybookOpen] = useState(false)

  // Selecting a job resets sub-state to the phase default (spec §1).
  useEffect(() => {
    if (!job) return
    setTab(defaultTabForStatus(job.status))
    setFiles(job.files)
    setPlaybookOpen(false)
  }, [job?.job_id, job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <Pane>
        <Center h="100%">
          <Loader color="brand" />
        </Center>
      </Pane>
    )
  }

  if (isError && !job) {
    return (
      <Pane>
        <Center h="100%" p="xl">
          <Stack align="center" gap="sm">
            <IconAlertCircle size={28} color="var(--rd)" />
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
      </Pane>
    )
  }

  if (!job) {
    return (
      <Pane>
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
      </Pane>
    )
  }

  const phase = jobPhase(job.status)
  const tabs = tabsForStatus(job.status)
  // Guard against a stale tab after a status transition.
  const activeTab = tabs.includes(tab) ? tab : defaultTabForStatus(job.status)
  const editableFiles = job.status === 'pending_processor_review'

  function applyOverride(index: number, patch: Partial<JobFile> & { approve?: boolean }) {
    setFiles((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f
        const { approve, ...rest } = patch
        const merged = { ...f, ...rest } as JobFile
        if (approve) {
          return { ...merged, status: 'Approved', notes: (rest as { notes?: string }).notes ?? '' } as JobFile
        }
        return merged
      }),
    )
  }

  function renderBody() {
    if (job!.status === 'failed') {
      return (
        <Box className="scroll-accent" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <FailureView job={job!} />
        </Box>
      )
    }

    if (phase === 0) {
      return (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap="sm">
            <Loader color="brand" />
            <Text fz={14} fw={500} c={tokens.textSecondary}>
              Processing documents…
            </Text>
            <Text fz={12.5} c={tokens.textTertiary}>
              {job!.message ?? 'Classifying uploaded files.'}
            </Text>
          </Stack>
        </Center>
      )
    }

    if (activeTab === 'Workpapers') {
      // Phase 2/3 evidence is read-only and reflects the job's saved files.
      const wpFiles = editableFiles ? files : job!.files
      return (
        <WorkpapersScreen
          job={job!}
          files={wpFiles}
          editable={editableFiles}
          onApplyOverride={applyOverride}
        />
      )
    }

    if (activeTab === 'Reconciliation') {
      return (
        <ReconciliationScreen
          job={job!}
          editable={job!.status === 'pending_reviewer_approval'}
        />
      )
    }

    // Full-width tabs — no rail (spec §7c).
    return (
      <Box className="scroll-accent" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {activeTab === 'Lead schedules' && <LeadSchedules results={job!.results} />}
        {activeTab === 'Compliance' && <Compliance job={job!} />}
        {activeTab === 'Agent logs' && <AgentLogs logs={job!.logs} />}
      </Box>
    )
  }

  return (
    <Pane>
      <WorkspaceHeader
        job={job}
        tab={activeTab}
        onTabChange={setTab}
        onOpenPlaybook={() => setPlaybookOpen(true)}
      />

      <Box style={{ flex: 1, display: 'flex', minHeight: 0 }}>{renderBody()}</Box>

      <WorkspaceFooter job={job} files={editableFiles ? files : job.files} />

      <PlaybookDrawer job={job} opened={playbookOpen} onClose={() => setPlaybookOpen(false)} />
    </Pane>
  )
}
