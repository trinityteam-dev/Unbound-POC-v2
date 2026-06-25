import { useEffect, useState } from 'react'
import { AppShell } from '@mantine/core'
import { useJobDetails, useJobs } from './api/hooks'
import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { isPhase2 } from './lib/status'
import { tokens } from './theme'

export default function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState<1 | 2>(1)

  const jobs = useJobs()
  const details = useJobDetails(selectedJobId)
  const job = details.data

  // Auto-select the first job once the list loads (demo convenience).
  useEffect(() => {
    if (!selectedJobId && jobs.data && jobs.data.length > 0) {
      setSelectedJobId(jobs.data[0].job_id)
    }
  }, [jobs.data, selectedJobId])

  // When the selected job changes, default the active step to match its stage.
  useEffect(() => {
    if (job) setActiveStep(isPhase2(job.status) ? 2 : 1)
  }, [job?.job_id, job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const step2Enabled = job ? isPhase2(job.status) : false

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 320, breakpoint: 'sm' }}
      padding={0}
    >
      <AppShell.Header style={{ borderBottom: `1px solid ${tokens.hairline}` }}>
        <AppHeader
          activeStep={activeStep}
          step2Enabled={step2Enabled}
          onStepChange={setActiveStep}
        />
      </AppShell.Header>

      <AppShell.Navbar withBorder={false} style={{ border: 'none' }}>
        <Sidebar selectedJobId={selectedJobId} onSelectJob={setSelectedJobId} />
      </AppShell.Navbar>

      <AppShell.Main
        style={{
          height: '100vh',
          background: tokens.canvas,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Workspace
          job={job}
          isLoading={!!selectedJobId && details.isLoading}
          activeStep={activeStep}
        />
      </AppShell.Main>
    </AppShell>
  )
}
