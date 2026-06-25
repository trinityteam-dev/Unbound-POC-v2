import { useEffect, useState } from 'react'
import { Badge, Button, Group, Modal, Stack, Table, Text, Textarea } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { useSetQueryStatus } from '../../api/hooks'
import { formatAud } from '../../api/format'
import type { ClientQuery } from '../../api/types'
import { tokens } from '../../theme'

export interface QueryModalProps {
  jobId: string
  query: ClientQuery | null
  editable: boolean
  onClose: () => void
}

export function QueryModal({ jobId, query, editable, onClose }: QueryModalProps) {
  const [text, setText] = useState('')
  const setStatus = useSetQueryStatus(jobId)

  useEffect(() => {
    if (query) setText(query.query_text)
  }, [query])

  function act(status: 'sent' | 'dismissed') {
    if (!query) return
    setStatus.mutate(
      { queryId: query.id, payload: { status, query_text: text } },
      {
        onSuccess: () => {
          notifications.show({
            color: status === 'sent' ? 'teal' : 'gray',
            title: status === 'sent' ? 'Query sent' : 'Query dismissed',
            message: query.category,
          })
          onClose()
        },
        onError: (err) =>
          notifications.show({
            color: 'red',
            title: 'Action failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    )
  }

  function confirmDismiss() {
    modals.openConfirmModal({
      title: 'Dismiss this query?',
      children: <Text fz={14}>This removes the query from the client list. You can’t undo it.</Text>,
      labels: { confirm: 'Dismiss', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => act('dismissed'),
    })
  }

  return (
    <Modal
      opened={!!query}
      onClose={onClose}
      title={query?.category ?? 'Query'}
      size="xl"
      centered
    >
      {query && (
        <Stack gap="md">
          <Badge
            color={query.status === 'sent' ? 'green' : query.status === 'pending' ? 'yellow' : 'gray'}
            variant="light"
            radius="sm"
            tt="capitalize"
            style={{ alignSelf: 'flex-start' }}
          >
            {query.status}
          </Badge>

          <Textarea
            label="Query text"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={4}
            maxRows={12}
            disabled={!editable}
          />

          <div>
            <Text fz={12.5} fw={500} c={tokens.textSecondary} mb={6}>
              Transactions ({query.transactions.length})
            </Text>
            <Table.ScrollContainer minWidth={400} mah={260} type="native">
              <Table verticalSpacing={6} horizontalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Description</Table.Th>
                    <Table.Th ta="right">Amount</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {query.transactions.map((t, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Text fz={12.5}>{t.date}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text fz={12.5}>{t.description}</Text>
                      </Table.Td>
                      <Table.Td ta="right" className="tabular-nums">
                        <Text fz={12.5}>
                          {formatAud(t.credit ?? (t.debit != null ? -t.debit : null))}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </div>

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            {editable && (
              <>
                <Button
                  variant="light"
                  color="gray"
                  loading={setStatus.isPending}
                  onClick={confirmDismiss}
                >
                  Dismiss
                </Button>
                <Button color="brand" loading={setStatus.isPending} onClick={() => act('sent')}>
                  Send to client
                </Button>
              </>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
