import { useState } from 'react'
import { Box, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconRefresh, IconRosette, IconWriting } from '@tabler/icons-react'
import {
  useProcessorReview,
  useRegroupQueries,
  useReviewerReview,
} from '../../api/hooks'
import { formatRelative } from '../../api/format'
import type { JobDetail, JobFile } from '../../api/types'
import { toReviewFile } from '../step1/utils'
import { jobPhase } from '../../lib/phase'
import { tokens } from '../../theme'

// Persistent job action (spec §8). Pinned to the bottom of the details pane and
// driven by PHASE, not the active tab — so it never changes when you switch tabs.
export interface WorkspaceFooterProps {
  job: JobDetail
  // The (possibly inline-edited) phase-1 files, owned by Workspace.
  files: JobFile[]
}

function FooterShell({
  hint,
  children,
}: {
  hint: string
  children?: React.ReactNode
}) {
  return (
    <Box
      px={20}
      py={10}
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${tokens.hairline}`,
        background: tokens.strip,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        borderRadius: '0 0 12px 12px',
      }}
    >
      <Text fz={12.5} c={tokens.textSecondary} truncate>
        {hint}
      </Text>
      <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
        {children}
      </Group>
    </Box>
  )
}

export function WorkspaceFooter({ job, files }: WorkspaceFooterProps) {
  const phase = jobPhase(job.status)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')

  const processor = useProcessorReview(job.job_id)
  const reviewer = useReviewerReview(job.job_id)
  const regroup = useRegroupQueries(job.job_id)

  function submitProcessor() {
    processor.mutate(
      { files: files.map(toReviewFile), processor_notes: notes },
      {
        onSuccess: () => {
          notifications.show({
            color: 'teal',
            title: 'Processor sign-off submitted',
            message: 'The AI reviewer is reconciling balances.',
          })
          setNotesOpen(false)
        },
        onError: (err) =>
          notifications.show({
            color: 'red',
            title: 'Sign-off failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    )
  }

  function completeReviewer() {
    reviewer.mutate(
      { reviewer_notes: notes },
      {
        onSuccess: () => {
          notifications.show({
            color: 'teal',
            title: 'Job completed',
            message: 'Reviewer sign-off recorded.',
          })
          setNotesOpen(false)
        },
        onError: (err) =>
          notifications.show({
            color: 'red',
            title: 'Sign-off failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    )
  }

  function doRegroup() {
    regroup.mutate(undefined, {
      onSuccess: () =>
        notifications.show({ color: 'teal', title: 'Queries regrouped', message: '' }),
      onError: (err) =>
        notifications.show({
          color: 'red',
          title: 'Regroup failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
    })
  }

  // Failed / unknown — no sign-off bar.
  if (phase == null) return null

  // Phase 0 — no action yet.
  if (phase === 0) {
    return <FooterShell hint="Sign-off available once classification completes" />
  }

  // Phase 1.5 — reconciling, read-only.
  if (phase === 1.5) {
    return <FooterShell hint="AI reviewer is reconciling — sign-off locked" />
  }

  // Phase 3 — completed, read-only.
  if (phase === 3) {
    const when = formatRelative(job.created_at)
    return (
      <FooterShell hint={`Completed · reviewer approved${when ? ` ${when}` : ''}`}>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={<IconDownload size={14} />}
        >
          Export
        </Button>
      </FooterShell>
    )
  }

  const isProcessor = phase === 1
  const title = isProcessor ? 'Processor sign-off' : 'Reviewer sign-off'
  const hint = isProcessor ? 'Processor sign-off' : 'Reviewer sign-off'
  const pending = isProcessor ? processor.isPending : reviewer.isPending

  return (
    <>
      <FooterShell hint={hint}>
        {!isProcessor && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<IconRefresh size={14} />}
            loading={regroup.isPending}
            onClick={doRegroup}
          >
            Regroup queries
          </Button>
        )}
        <Button
          color="brand"
          size="compact-sm"
          leftSection={isProcessor ? <IconWriting size={14} /> : <IconRosette size={14} />}
          onClick={() => setNotesOpen(true)}
        >
          {isProcessor ? 'Submit sign-off' : 'Approve & complete'}
        </Button>
      </FooterShell>

      <Modal opened={notesOpen} onClose={() => setNotesOpen(false)} title={title} centered>
        <Stack gap="sm">
          <Textarea
            label={isProcessor ? 'Processor notes & escalation comments' : 'Reviewer notes'}
            placeholder={
              isProcessor
                ? 'Note any ledger discrepancies, missing client details…'
                : 'Final review comments, audit conclusions, outstanding items…'
            }
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            autosize
            minRows={3}
          />
          <Text fz={12} c={tokens.textTertiary}>
            {isProcessor
              ? 'Submitting compiles approved files and triggers the AI Reviewer to calculate lead schedules.'
              : 'Completing closes the audit and moves the job to completed.'}
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setNotesOpen(false)}>
              Cancel
            </Button>
            <Button
              color="brand"
              loading={pending}
              onClick={isProcessor ? submitProcessor : completeReviewer}
            >
              {isProcessor ? 'Submit sign-off' : 'Approve & complete'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
