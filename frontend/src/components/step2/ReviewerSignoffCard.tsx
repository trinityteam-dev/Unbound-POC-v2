import { useState } from 'react'
import { Button, Group, Text, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconRosette } from '@tabler/icons-react'
import { useRegroupQueries, useReviewerReview } from '../../api/hooks'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

export interface ReviewerSignoffCardProps {
  jobId: string
  enabled: boolean
}

export function ReviewerSignoffCard({ jobId, enabled }: ReviewerSignoffCardProps) {
  const [notes, setNotes] = useState('')
  const review = useReviewerReview(jobId)
  const regroup = useRegroupQueries(jobId)

  function complete() {
    review.mutate(
      { reviewer_notes: notes },
      {
        onSuccess: () =>
          notifications.show({
            color: 'teal',
            title: 'Job completed',
            message: 'Reviewer sign-off recorded.',
          }),
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

  return (
    <Card title="Human Auditor & Reviewer Final Sign-off">
      <Textarea
        label="Reviewer notes"
        placeholder="Final review comments, audit conclusions, outstanding items…"
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        autosize
        minRows={3}
        disabled={!enabled}
      />
      <Group justify="space-between" align="center" mt="md" wrap="nowrap" gap="lg">
        <Text fz={12.5} c={tokens.textTertiary} maw={360}>
          {enabled
            ? 'Completing closes the audit and moves the job to completed.'
            : 'Final sign-off is available only while the job is pending reviewer approval.'}
        </Text>
        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            loading={regroup.isPending}
            disabled={!enabled}
            onClick={doRegroup}
          >
            Regroup queries
          </Button>
          <Button
            color="brand"
            leftSection={<IconRosette size={16} />}
            loading={review.isPending}
            disabled={!enabled}
            onClick={complete}
          >
            Complete & sign off
          </Button>
        </Group>
      </Group>
    </Card>
  )
}
