import {
  Box,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconHome, IconPlus, IconRefresh } from '@tabler/icons-react'
import type { Job } from '../api/types'
import { formatRelativeShort } from '../api/format'
import { statusDotColor } from '../lib/status'
import { useJobs, useModels } from '../api/hooks'
import { tokens } from '../theme'

// De-boxed navy sidebar (spec §3). The job list is the hero: status dot +
// fund name, no fills, no outlines. A "Home" row returns to the landing
// dashboard; "＋ New audit job" opens the shared run-config modal.
export interface SidebarProps {
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
  onGoHome: () => void
  onNewAudit: () => void
  width: number
  selectedModel: string | null
  onSelectModel: (model: string) => void
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

export function Sidebar({
  selectedJobId,
  onSelectJob,
  onGoHome,
  onNewAudit,
  width,
  selectedModel,
  onSelectModel,
}: SidebarProps) {
  const jobs = useJobs()
  const models = useModels()
  const homeActive = selectedJobId === null
  const modelOptions =
    models.data?.models.map((m) => ({ value: m.model, label: m.label })) ?? []
  // Fall back to the configured default until the parent has a selection.
  const currentModel = selectedModel ?? models.data?.default ?? null

  return (
    <Stack
      gap={0}
      className="sidebar-panel"
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
      {/* Home — returns to the landing dashboard */}
      <UnstyledButton
        onClick={onGoHome}
        className="hover-row"
        style={{
          borderRadius: 7,
          padding: '8px 10px',
          borderLeft: `2px solid ${homeActive ? tokens.accent : 'transparent'}`,
        }}
      >
        <Group gap={10} wrap="nowrap">
          <IconHome size={16} color={homeActive ? tokens.accentTeal : 'var(--s2)'} stroke={2.2} />
          <Text fz={13} fw={homeActive ? 600 : 500} c={homeActive ? tokens.accentTeal : 'var(--s1)'}>
            Home
          </Text>
        </Group>
      </UnstyledButton>

      {/* ＋ New audit job — opens the run-config modal on demand */}
      <UnstyledButton
        onClick={onNewAudit}
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

      {/* Connected engine — one-line model picker, pinned to the bottom */}
      <Box
        pt={10}
        mt={8}
        px={6}
        style={{ borderTop: `1px solid ${tokens.hairline}`, flexShrink: 0 }}
      >
        <Group gap={8} wrap="nowrap" align="center">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: tokens.success,
              boxShadow: `0 0 0 3px ${tokens.primaryTint}`,
              flexShrink: 0,
            }}
          />
          <Text
            fz={10.5}
            fw={700}
            tt="uppercase"
            c="var(--s3)"
            style={{ letterSpacing: 0.6, flexShrink: 0 }}
          >
            Engine
          </Text>
          <Select
            size="xs"
            data={modelOptions}
            value={currentModel}
            onChange={(value) => value && onSelectModel(value)}
            placeholder={models.isLoading ? 'Loading…' : 'Select model'}
            disabled={models.isLoading || modelOptions.length === 0}
            allowDeselect={false}
            checkIconPosition="right"
            rightSection={<IconChevronDown size={12} color="var(--s3)" stroke={2.4} />}
            comboboxProps={{ position: 'top', width: 200, offset: 6, transitionProps: { transition: 'pop', duration: 120 } }}
            classNames={{
              input: 'engine-select-input',
              dropdown: 'engine-select-dropdown',
              option: 'engine-select-option',
            }}
            style={{ flex: 1, minWidth: 0 }}
          />
        </Group>
      </Box>
    </Stack>
  )
}
