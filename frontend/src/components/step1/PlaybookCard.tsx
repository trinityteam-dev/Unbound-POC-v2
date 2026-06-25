import { useEffect, useState } from 'react'
import { Button, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useSavePlaybook } from '../../api/hooks'
import type { Fund, JobDetail } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'
import { playbookToRows, rowsToPlaybook } from './utils'

export interface PlaybookCardProps {
  job: JobDetail
  funds: Fund[] | undefined
}

export function PlaybookCard({ job, funds }: PlaybookCardProps) {
  const fund = funds?.find((f) => f.id === job.fund_id)
  const playbook = fund?.keywords?.[job.job_type] ?? {}
  const save = useSavePlaybook()

  const [rows, setRows] = useState<Record<string, string>>(() =>
    playbookToRows(playbook),
  )

  // Reseed when the fund or job type changes.
  useEffect(() => {
    setRows(playbookToRows(fund?.keywords?.[job.job_type] ?? {}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fund?.id, job.job_type])

  const categories = Object.keys(rows)

  function handleSave() {
    if (!fund) return
    save.mutate(
      {
        id: fund.id,
        keywords: { ...(fund.keywords ?? {}), [job.job_type]: rowsToPlaybook(rows) },
      },
      {
        onSuccess: () =>
          notifications.show({
            color: 'teal',
            title: 'Playbook saved',
            message: 'Classification keywords updated.',
          }),
        onError: (err) =>
          notifications.show({
            color: 'red',
            title: 'Save failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    )
  }

  return (
    <Card
      title="Playbook Manager"
      accent="violet"
      subtitle="Keywords the AI uses during document classification for this playbook."
    >
      {categories.length === 0 ? (
        <Text fz={13} c={tokens.textTertiary}>
          No playbook categories for this fund / job type.
        </Text>
      ) : (
        <>
          <Stack gap="sm" mah={520} style={{ overflowY: 'auto' }}>
            {categories.map((cat) => (
              <div key={cat}>
                <Text fz={12.5} fw={500} c={tokens.textSecondary} mb={4}>
                  {cat}
                </Text>
                <TextInput
                  size="xs"
                  value={rows[cat]}
                  placeholder="comma, separated, keywords"
                  onChange={(e) =>
                    setRows((prev) => ({ ...prev, [cat]: e.currentTarget.value }))
                  }
                />
              </div>
            ))}
          </Stack>
          <Button
            fullWidth
            mt="lg"
            color="brand"
            loading={save.isPending}
            disabled={!fund}
            onClick={handleSave}
          >
            Save playbook changes
          </Button>
        </>
      )}
    </Card>
  )
}
