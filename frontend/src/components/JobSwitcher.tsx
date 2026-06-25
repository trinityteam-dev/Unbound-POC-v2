import { useEffect, useState } from 'react'
import { Kbd, Modal, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useDisclosure, useHotkeys } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import type { Job } from '../api/types'
import { statusMeta, statusDotColor } from '../lib/status'
import { tokens } from '../theme'

// ⌘K / Ctrl-K job switcher.
export function JobSwitcher({
  jobs,
  onSelect,
}: {
  jobs: Job[] | undefined
  onSelect: (jobId: string) => void
}) {
  const [opened, { open, close }] = useDisclosure(false)
  const [q, setQ] = useState('')

  useHotkeys([['mod+K', open]])

  useEffect(() => {
    if (opened) setQ('')
  }, [opened])

  const filtered = (jobs ?? []).filter((j) =>
    (j.fund_name ?? '').toLowerCase().includes(q.trim().toLowerCase()),
  )

  function choose(jobId: string) {
    onSelect(jobId)
    close()
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      withCloseButton={false}
      size="lg"
      padding={0}
      radius="lg"
    >
      <TextInput
        autoFocus
        variant="unstyled"
        size="md"
        placeholder="Switch to a job…"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        leftSection={<IconSearch size={18} />}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered[0]) choose(filtered[0].job_id)
        }}
        styles={{ input: { padding: '16px 16px 16px 4px', fontSize: 16 } }}
      />
      <div style={{ borderTop: `1px solid ${tokens.hairline}` }} />
      <ScrollArea.Autosize mah={360} type="scroll">
        <Stack gap={2} p={8}>
          {filtered.length === 0 ? (
            <Text fz={13} c={tokens.textTertiary} p="md" ta="center">
              No matching jobs.
            </Text>
          ) : (
            filtered.map((j) => (
              <UnstyledButton
                key={j.job_id}
                onClick={() => choose(j.job_id)}
                className="job-row-light"
                style={{ padding: '9px 12px', borderRadius: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: statusDotColor[j.status] ?? '#94A3B8',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fz={14} truncate>
                      {j.fund_name ?? '(unnamed fund)'}
                    </Text>
                    <Text fz={11.5} c={tokens.textTertiary}>
                      {statusMeta[j.status]?.label ?? j.status}
                    </Text>
                  </div>
                </div>
              </UnstyledButton>
            ))
          )}
        </Stack>
      </ScrollArea.Autosize>
      <div
        style={{
          borderTop: `1px solid ${tokens.hairline}`,
          padding: '8px 14px',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <Kbd size="xs">↵</Kbd>
        <Text fz={11.5} c={tokens.textTertiary}>
          open
        </Text>
        <Kbd size="xs">esc</Kbd>
        <Text fz={11.5} c={tokens.textTertiary}>
          close
        </Text>
      </div>
    </Modal>
  )
}
