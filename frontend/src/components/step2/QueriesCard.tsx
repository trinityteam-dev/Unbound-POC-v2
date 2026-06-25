import { Group, Stack, Text, UnstyledButton } from '@mantine/core'
import type { ClientQuery, QueryStatus } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

const STATUS_DOT: Record<string, string> = {
  pending: '#F59E0B',
  sent: '#16A34A',
  dismissed: '#94A3B8',
}

function dotColor(status: QueryStatus): string {
  return STATUS_DOT[status] ?? '#94A3B8'
}

export interface QueriesCardProps {
  queries: ClientQuery[]
  onOpen: (q: ClientQuery) => void
}

export function QueriesCard({ queries, onOpen }: QueriesCardProps) {
  return (
    <Card
      title="Client Queries"
      accent="amber"
      action={
        <Text fz={12.5} c={tokens.textTertiary}>
          {queries.length}
        </Text>
      }
    >
      {queries.length === 0 ? (
        <Text fz={13} c={tokens.textTertiary}>
          No queries raised. Ledger is clean.
        </Text>
      ) : (
        <Stack gap={2}>
          {queries.map((q) => (
            <UnstyledButton
              key={q.id}
              onClick={() => onOpen(q)}
              className="job-row"
              style={{ borderRadius: 8, padding: '10px 12px' }}
            >
              <Group gap={10} wrap="nowrap">
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: dotColor(q.status),
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text fz={13.5} fw={500} truncate>
                    {q.category}
                  </Text>
                  <Text fz={11.5} c={tokens.textTertiary} tt="capitalize">
                    {q.status} · {q.transactions.length} txns
                  </Text>
                </div>
                <Text fz={12.5} c={tokens.accentTeal} fw={500}>
                  Open
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Card>
  )
}
