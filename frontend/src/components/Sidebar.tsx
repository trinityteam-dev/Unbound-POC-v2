import { Box, Group, Loader, Select, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronRight, IconRefresh, IconTriangleFilled } from '@tabler/icons-react'
import type { Job } from '../api/types'
import { formatRelative } from '../api/format'
import { statusDotColor, statusMeta } from '../lib/status'
import { useFunds, useJobs } from '../api/hooks'
import { tokens } from '../theme'

// Dark sidebar — mirrors the existing IA (templates/index.html:1637):
// brand, "Configure Audit Job" form, "Job Executions" list, engine footer.
// Restyled per spec §3/§5. The config form is a stub here (wired in Phase 3).
export interface SidebarProps {
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  color: tokens.sidebarTextFaint,
}

function JobRow({
  job,
  active,
  onClick,
}: {
  job: Job
  active: boolean
  onClick: () => void
}) {
  const meta = statusMeta[job.status]
  const rel = formatRelative(job.created_at)
  return (
    <UnstyledButton
      onClick={onClick}
      className={active ? undefined : 'job-row'}
      style={{
        display: 'block',
        width: '100%',
        padding: '9px 12px',
        borderRadius: 8,
        background: active ? tokens.sidebarActiveBg : undefined,
        borderLeft: `3px solid ${active ? tokens.accent : 'transparent'}`,
        transition: 'background 120ms ease',
      }}
    >
      <Group gap={10} wrap="nowrap">
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: statusDotColor[job.status],
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text
            fz={13.5}
            fw={active ? 600 : 500}
            c={active ? tokens.sidebarText : tokens.sidebarTextMuted}
            truncate
          >
            {job.fund_name}
          </Text>
          <Text fz={11.5} c={tokens.sidebarTextFaint} truncate mt={1}>
            {meta.label}
            {rel ? ` · ${rel}` : ''}
          </Text>
        </div>
        <IconChevronRight
          size={16}
          color={tokens.sidebarTextFaint}
          style={{ flexShrink: 0 }}
        />
      </Group>
    </UnstyledButton>
  )
}

export function Sidebar({ selectedJobId, onSelectJob }: SidebarProps) {
  const jobs = useJobs()
  const funds = useFunds()

  const fundOptions =
    funds.data
      ?.filter((f) => !!f.id)
      .map((f) => ({ value: f.id, label: f.name ?? f.id })) ?? []

  return (
    <Stack
      h="100%"
      gap={0}
      p={20}
      style={{ background: tokens.sidebarBg, color: tokens.sidebarText }}
    >
      {/* Brand */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }} mb="lg">
        <IconTriangleFilled size={17} color={tokens.primaryGreen} />
        <div>
          <Text fw={700} fz={16} c={tokens.sidebarText} lh={1.15}>
            SMSF Orchestrator
          </Text>
          <Text fz={11.5} c={tokens.sidebarTextFaint}>
            Doc Intelligence Platform
          </Text>
        </div>
      </Box>

      {/* Configure Audit Job (stub — wired in Phase 3) */}
      <Text style={SECTION_TITLE} mb="xs">
        Configure Audit Job
      </Text>
      <Stack gap="xs" mb="lg">
        <Select
          size="sm"
          placeholder="Select fund"
          data={fundOptions}
          searchable
          nothingFoundMessage="No funds"
        />
        <Select
          size="sm"
          placeholder="Active playbook"
          defaultValue="Accounting_Audit"
          data={[
            { value: 'Accounting_Audit', label: 'Accounting & Audit (Full)' },
            { value: 'Accounting', label: 'Accounting (Limited Ledger)' },
          ]}
        />
        <UnstyledButton
          style={{
            textAlign: 'center',
            padding: '11px 14px',
            borderRadius: 8,
            border: `1px solid ${tokens.primaryGreen}`,
            color: tokens.primaryGreen,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          + New audit
        </UnstyledButton>
      </Stack>

      {/* Job Executions */}
      <Box
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        mb="xs"
      >
        <Text style={SECTION_TITLE}>Job Executions</Text>
        <UnstyledButton onClick={() => jobs.refetch()} title="Refresh">
          <IconRefresh size={14} color={tokens.sidebarTextFaint} />
        </UnstyledButton>
      </Box>

      <Stack gap={2} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {jobs.isLoading ? (
          <Loader size="xs" color="brand" />
        ) : jobs.isError ? (
          <Text size="xs" c="red.4">
            Failed to load jobs
          </Text>
        ) : (
          jobs.data?.map((job) => (
            <JobRow
              key={job.job_id}
              job={job}
              active={job.job_id === selectedJobId}
              onClick={() => onSelectJob(job.job_id)}
            />
          ))
        )}
      </Stack>

      {/* Engine footer */}
      <Box pt="sm" mt="sm" style={{ borderTop: `1px solid rgba(255,255,255,.08)` }}>
        <Text fz={11} c={tokens.sidebarTextFaint}>
          Connected Engine
        </Text>
        <Text fz={12.5} c={tokens.primaryGreen} fw={600} mt={2}>
          ● OpenRouter x-ai/grok-4.20
        </Text>
      </Box>
    </Stack>
  )
}
