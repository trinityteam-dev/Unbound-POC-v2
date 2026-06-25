import { useState } from 'react'
import { Box, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconLoader2 } from '@tabler/icons-react'
import type { AuditorNote, ClientQuery, JobDetail } from '../../api/types'
import { tokens } from '../../theme'
import type { Step2Tab } from '../WorkspaceHeader'
import { AgentLogs } from './AgentLogs'
import { Compliance } from './Compliance'
import { LeadSchedules } from './LeadSchedules'
import { MetricStrip } from './MetricStrip'
import { QueriesCard } from './QueriesCard'
import { QueryModal } from './QueryModal'
import { ReconciliationCard } from './ReconciliationCard'
import { ReviewerSignoffCard } from './ReviewerSignoffCard'

function RunningBanner() {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: tokens.primaryTint,
        border: `1px solid rgba(45,212,191,.28)`,
        borderRadius: 10,
        padding: '12px 16px',
      }}
    >
      <IconLoader2 size={18} color={tokens.accentTeal} className="wf-spin" />
      <Text fz={13} c={tokens.accentTeal}>
        AI reviewer is reconciling balances — results will populate as they complete.
      </Text>
    </Box>
  )
}

export function Step2({ job, subTab }: { job: JobDetail; subTab: Step2Tab }) {
  const [openQuery, setOpenQuery] = useState<ClientQuery | null>(null)

  const editable = job.status === 'pending_reviewer_approval'
  const running = job.status === 'processing_review'

  const p2 = job.phase2_context
  const summary = p2?.summary
  const queries = p2?.queries ?? []
  const exceptions = (job.auditor_notes as AuditorNote[] | undefined)?.length ?? 0

  if (subTab === 'Lead Schedules') {
    return (
      <Stack gap="lg">
        {running && <RunningBanner />}
        <LeadSchedules results={job.results} />
      </Stack>
    )
  }

  if (subTab === 'Compliance') {
    return (
      <Stack gap="lg">
        {running && <RunningBanner />}
        <Compliance job={job} />
      </Stack>
    )
  }

  if (subTab === 'Agent Logs') {
    return <AgentLogs logs={job.logs} />
  }

  // Reconciliation & Queries (default)
  return (
    <>
      <Stack gap="lg">
        {running && <RunningBanner />}
        <MetricStrip
          total={summary?.total ?? 0}
          matched={summary?.matched ?? 0}
          unmatched={summary?.unmatched ?? 0}
          queries={queries.length}
          exceptions={exceptions}
        />
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" style={{ alignItems: 'start' }}>
          <ReconciliationCard recon={p2?.reconciliation_results} />
          <QueriesCard queries={queries} onOpen={setOpenQuery} />
        </SimpleGrid>
        <ReviewerSignoffCard jobId={job.job_id} enabled={editable} />
      </Stack>

      <QueryModal
        jobId={job.job_id}
        query={openQuery}
        editable={editable}
        onClose={() => setOpenQuery(null)}
      />
    </>
  )
}
