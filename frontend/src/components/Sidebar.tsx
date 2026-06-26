import { useState } from 'react'
import {
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronRight, IconPlus, IconRefresh } from '@tabler/icons-react'
import type { Job } from '../api/types'
import { formatRelativeShort } from '../api/format'
import { statusDotColor } from '../lib/status'
import { useCreateJob, useFunds, useJobs } from '../api/hooks'
import { tokens } from '../theme'

// De-boxed charcoal sidebar (spec §3). The job list is the hero: status dot +
// fund name, no fills, no outlines. The run-config form is collapsed behind a
// single "＋ New audit job" row that opens a modal on demand.
export interface SidebarProps {
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
  width: number
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.9,
  textTransform: 'uppercase',
  color: 'var(--s3)',
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
  return (
    <UnstyledButton
      onClick={onClick}
      className="job-row hover-row"
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 10px 8px 12px',
        borderRadius: 7,
        borderLeft: `2px solid ${active ? tokens.accent : 'transparent'}`,
      }}
    >
      <Group gap={10} wrap="nowrap">
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusDotColor[job.status],
            flexShrink: 0,
          }}
        />
        <Text
          className="job-row-name"
          fz={13}
          fw={active ? 600 : 500}
          c={active ? tokens.accentTeal : 'var(--s2)'}
          truncate
          style={{ flex: 1, minWidth: 0 }}
        >
          {job.fund_name}
        </Text>
        {/* Run time at rest, swaps to a chevron on hover — same slot, no shift */}
        <span
          style={{
            position: 'relative',
            flexShrink: 0,
            minWidth: 26,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <Text
            className="job-row-time tabular-nums"
            fz={10.5}
            c="var(--s3)"
            style={{ whiteSpace: 'nowrap' }}
          >
            {formatRelativeShort(job.created_at)}
          </Text>
          <IconChevronRight
            className="job-row-chevron"
            size={14}
            color="var(--s3)"
            style={{ position: 'absolute', right: -2 }}
          />
        </span>
      </Group>
    </UnstyledButton>
  )
}

function NewAuditModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean
  onClose: () => void
  onCreated: (jobId: string) => void
}) {
  const funds = useFunds()
  const createJob = useCreateJob()
  const [fundId, setFundId] = useState<string | null>(null)
  const [jobType, setJobType] = useState<string | null>('Accounting_Audit')

  const fundOptions =
    funds.data
      ?.filter((f) => !!f.id)
      .map((f) => ({ value: f.id, label: f.name ?? f.id })) ?? []

  function handleRun() {
    if (!fundId || createJob.isPending) return
    createJob.mutate(
      { fund_id: fundId, job_type: jobType ?? 'Accounting_Audit' },
      {
        onSuccess: (res) => {
          notifications.show({
            color: 'teal',
            title: 'Audit started',
            message: 'The AI processor is classifying documents.',
          })
          setFundId(null)
          onCreated(res.job_id)
          onClose()
        },
        onError: (err) => {
          notifications.show({
            color: 'red',
            title: 'Could not start audit',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        },
      },
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} title="New audit job" centered>
      <Stack gap="sm">
        <Select
          label="Fund"
          placeholder="Select fund"
          data={fundOptions}
          value={fundId}
          onChange={setFundId}
          searchable
          nothingFoundMessage="No funds"
          disabled={funds.isLoading}
        />
        <Select
          label="Playbook"
          value={jobType}
          onChange={setJobType}
          allowDeselect={false}
          data={[
            { value: 'Accounting_Audit', label: 'Accounting & Audit (Full)' },
            { value: 'Accounting', label: 'Accounting (Limited Ledger)' },
          ]}
        />
        <Button
          fullWidth
          mt="xs"
          color="brand"
          loading={createJob.isPending}
          disabled={!fundId}
          onClick={handleRun}
        >
          Run audit pipeline
        </Button>
      </Stack>
    </Modal>
  )
}

export function Sidebar({ selectedJobId, onSelectJob, width }: SidebarProps) {
  const jobs = useJobs()
  const [newOpen, setNewOpen] = useState(false)

  return (
    <Stack
      gap={0}
      style={{
        width,
        flexShrink: 0,
        background: tokens.sidebarBg,
        color: 'var(--s1)',
        borderRadius: 12,
        border: `1px solid ${tokens.accentBorder}`,
        padding: '14px 12px 12px',
      }}
    >
      {/* ＋ New audit job — opens the run-config modal on demand */}
      <UnstyledButton
        onClick={() => setNewOpen(true)}
        className="hover-row"
        style={{ borderRadius: 7, padding: '8px 10px' }}
      >
        <Group gap={10} wrap="nowrap">
          <IconPlus size={16} color={tokens.accentTeal} stroke={2.4} />
          <Text fz={13} fw={500} c="var(--s1)">
            New audit job
          </Text>
        </Group>
      </UnstyledButton>

      <Box
        style={{ borderTop: `1px solid ${tokens.hairline}`, margin: '10px 4px 12px' }}
      />

      {/* JOB EXECUTIONS · n */}
      <Group justify="space-between" align="center" px={6} mb={6} wrap="nowrap">
        <Text style={SECTION_TITLE}>Job executions · {jobs.data?.length ?? 0}</Text>
        <UnstyledButton onClick={() => jobs.refetch()} title="Refresh" aria-label="Refresh jobs">
          <IconRefresh size={13} color="var(--s3)" />
        </UnstyledButton>
      </Group>

      {/* Boxless scrollable job list */}
      <Stack
        gap={1}
        className="scroll-accent"
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
      >
        {jobs.isLoading ? (
          <Loader size="xs" color="brand" mt="sm" mx="auto" />
        ) : jobs.isError ? (
          <Text size="xs" c="red.4" px={10} mt="sm">
            Failed to load jobs
          </Text>
        ) : (
          jobs.data?.map((job, i) => (
            <JobRow
              key={`${job.job_id}-${i}`}
              job={job}
              active={job.job_id === selectedJobId}
              onClick={() => onSelectJob(job.job_id)}
            />
          ))
        )}
      </Stack>

      {/* Connected engine — pinned to the bottom */}
      <Box
        pt={10}
        mt={8}
        px={6}
        style={{ borderTop: `1px solid ${tokens.hairline}`, flexShrink: 0 }}
      >
        <Group gap={7} wrap="nowrap">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: tokens.success,
              flexShrink: 0,
            }}
          />
          <Text fz={11.5} c="var(--s2)" truncate>
            Engine · grok-4.20
          </Text>
        </Group>
      </Box>

      <NewAuditModal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={onSelectJob}
      />
    </Stack>
  )
}
