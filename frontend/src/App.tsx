import { useEffect, useState } from 'react'
import { Box } from '@mantine/core'
import { useJobDetails, useJobs } from './api/hooks'
import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'

// One stable frame (spec §2): top bar → [sidebar panel · details pane] with a
// thin gutter showing the canvas between the two rounded panels. Phase is driven
// by the selected job's status — there is no Step 1/Step 2 toggle.
export default function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const jobs = useJobs()
  const details = useJobDetails(selectedJobId)
  const job = details.data

  // Auto-select the first job once the list loads (demo convenience).
  useEffect(() => {
    if (!selectedJobId && jobs.data && jobs.data.length > 0) {
      setSelectedJobId(jobs.data[0].job_id)
    }
  }, [jobs.data, selectedJobId])

  return (
    <Box
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <Box style={{ flexShrink: 0 }}>
        <AppHeader />
      </Box>

      {/* Two panels separated by a small gutter showing the canvas (spec §2). */}
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 6,
          padding: '0 6px 6px',
        }}
      >
        <Sidebar selectedJobId={selectedJobId} onSelectJob={setSelectedJobId} />
        <Workspace
          job={job}
          isLoading={!!selectedJobId && details.isLoading}
          isError={details.isError}
          onRetry={() => details.refetch()}
        />
      </Box>
    </Box>
  )
}
