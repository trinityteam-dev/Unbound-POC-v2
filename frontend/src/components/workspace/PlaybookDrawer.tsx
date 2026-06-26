import { useEffect, useState } from 'react'
import { Box, Button, Drawer, Group, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconSettings } from '@tabler/icons-react'
import { useFunds, useSavePlaybook } from '../../api/hooks'
import type { JobDetail } from '../../api/types'
import { playbookToRows, rowsToPlaybook } from '../step1/utils'
import { tokens } from '../../theme'

// Fund-level config, reachable in every phase (spec §9). Slide-over drawer with
// a violet accent (configuration, distinct from teal data / amber attention).
export interface PlaybookDrawerProps {
  job: JobDetail
  opened: boolean
  onClose: () => void
}

export function PlaybookDrawer({ job, opened, onClose }: PlaybookDrawerProps) {
  const funds = useFunds()
  const fund = funds.data?.find((f) => f.id === job.fund_id)
  const save = useSavePlaybook()

  const [rows, setRows] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(playbookToRows(fund?.keywords?.[job.job_type] ?? {}))
  }, [fund?.id, job.job_type, opened]) // eslint-disable-line react-hooks/exhaustive-deps

  const categories = Object.keys(rows)

  function handleSave() {
    if (!fund) return
    save.mutate(
      {
        id: fund.id,
        keywords: { ...(fund.keywords ?? {}), [job.job_type]: rowsToPlaybook(rows) },
      },
      {
        onSuccess: () => {
          notifications.show({
            color: 'teal',
            title: 'Playbook saved',
            message: 'Classification keywords updated.',
          })
          onClose()
        },
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
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={420}
      withCloseButton={false}
      padding={0}
      styles={{ content: { background: tokens.surface }, body: { height: '100%' } }}
    >
      <Stack gap={0} h="100%">
        <Group
          px={20}
          py={14}
          justify="space-between"
          wrap="nowrap"
          style={{ borderBottom: `2px solid var(--vi)` }}
        >
          <Group gap={8} wrap="nowrap">
            <IconSettings size={16} color={tokens.violet} />
            <Box>
              <Text fz={14} fw={600} c={tokens.textPrimary}>
                Playbook
              </Text>
              <Text fz={11.5} c={tokens.textTertiary}>
                {fund?.name ?? job.fund_name} · {job.job_type}
              </Text>
            </Box>
          </Group>
          <Button variant="subtle" color="gray" size="compact-sm" onClick={onClose}>
            Close
          </Button>
        </Group>

        <Box className="scroll-accent" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <Text fz={12.5} c={tokens.textTertiary} mb="md">
            Keywords the AI uses during document classification for this playbook.
          </Text>
          {categories.length === 0 ? (
            <Text fz={13} c={tokens.textTertiary}>
              No playbook categories for this fund / job type.
            </Text>
          ) : (
            <Stack gap="sm">
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
          )}
        </Box>

        <Box px={20} py={14} style={{ borderTop: `1px solid ${tokens.hairline}` }}>
          <Button
            fullWidth
            color="brand"
            loading={save.isPending}
            disabled={!fund || categories.length === 0}
            onClick={handleSave}
          >
            Save playbook
          </Button>
        </Box>
      </Stack>
    </Drawer>
  )
}
