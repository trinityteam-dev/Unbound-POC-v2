import { useState } from 'react'
import { Button, Group, Text, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconWriting } from '@tabler/icons-react'
import { useProcessorReview } from '../../api/hooks'
import type { JobFile } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'
import { toReviewFile } from './utils'

export interface ProcessorSignoffCardProps {
  jobId: string
  files: JobFile[]
  enabled: boolean
}

export function ProcessorSignoffCard({ jobId, files, enabled }: ProcessorSignoffCardProps) {
  const [notes, setNotes] = useState('')
  const review = useProcessorReview(jobId)

  function submit() {
    review.mutate(
      { files: files.map(toReviewFile), processor_notes: notes },
      {
        onSuccess: () =>
          notifications.show({
            color: 'teal',
            title: 'Processor sign-off submitted',
            message: 'The AI reviewer is reconciling balances.',
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

  return (
    <Card title="Human Processor Sign-off Escalation" accent="blue">
      <Textarea
        label="Processor notes & escalation comments"
        placeholder="Note any ledger discrepancies, missing client details, or bookkeeping issues…"
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        autosize
        minRows={3}
        disabled={!enabled}
      />
      <Group justify="space-between" align="center" mt="md" wrap="nowrap" gap="lg">
        <Text fz={12.5} c={tokens.textTertiary} maw={380}>
          {enabled
            ? 'Submitting compiles approved files and triggers the AI Reviewer Agent to calculate financial lead schedules.'
            : 'Sign-off is available only while the job is pending processor review.'}
        </Text>
        <Button
          color="brand"
          leftSection={<IconWriting size={16} />}
          loading={review.isPending}
          disabled={!enabled}
          onClick={submit}
          style={{ flexShrink: 0 }}
        >
          Submit sign-off
        </Button>
      </Group>
    </Card>
  )
}
