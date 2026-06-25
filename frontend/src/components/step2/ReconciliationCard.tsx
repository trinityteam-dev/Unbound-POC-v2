import { useState } from 'react'
import { Group, Table, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { IconCheck, IconHelpCircle } from '@tabler/icons-react'
import { formatAud } from '../../api/format'
import type { ReconciliationResults } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

export function ReconciliationCard({ recon }: { recon: ReconciliationResults | undefined }) {
  const accounts = Object.values(recon ?? {})
  const [active, setActive] = useState(0)

  if (accounts.length === 0) {
    return (
      <Card title="Bank Transaction Reconciliation">
        <Text fz={13} c={tokens.textTertiary}>
          No reconciliation data yet.
        </Text>
      </Card>
    )
  }

  const acct = accounts[Math.min(active, accounts.length - 1)]

  return (
    <Card
      title="Bank Transaction Reconciliation"
      action={
        accounts.length > 1 ? (
          <Group gap={6}>
            {accounts.map((a, i) => (
              <UnstyledButton
                key={a.account_number}
                onClick={() => setActive(i)}
                style={{
                  fontSize: 12,
                  padding: '3px 9px',
                  borderRadius: 6,
                  fontWeight: i === active ? 600 : 400,
                  color: i === active ? '#0F766E' : tokens.textSecondary,
                  background: i === active ? '#E1F2F0' : 'transparent',
                }}
              >
                {a.account_number}
              </UnstyledButton>
            ))}
          </Group>
        ) : undefined
      }
    >
      <Text fz={13} c={tokens.textSecondary} mb="sm">
        {acct.account_name} · {acct.account_number}
      </Text>
      <Table.ScrollContainer minWidth={420} mah={460} type="native">
        <Table verticalSpacing={7} horizontalSpacing="sm" style={{ tableLayout: 'fixed' }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: '16%' }}>Date</Table.Th>
              <Table.Th style={{ width: '50%' }}>Description</Table.Th>
              <Table.Th ta="right" style={{ width: '22%' }}>
                Amount
              </Table.Th>
              <Table.Th ta="center" style={{ width: '12%' }}>
                Match
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {acct.transactions.map((t, i) => {
              const matched = t.status === 'matched'
              const amount = t.credit ?? (t.debit != null ? -t.debit : null)
              return (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Text fz={12.5}>{t.date}</Text>
                  </Table.Td>
                  <Table.Td style={{ wordBreak: 'break-word' }}>
                    <Text fz={12.5}>{t.description}</Text>
                  </Table.Td>
                  <Table.Td ta="right" className="tabular-nums">
                    <Text fz={12.5} c={t.credit != null ? '#16A34A' : tokens.textPrimary}>
                      {formatAud(amount)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="center">
                    {matched ? (
                      <IconCheck size={16} color="#16A34A" />
                    ) : (
                      <Tooltip
                        label={t.unmatched_reason ?? 'Unmatched'}
                        multiline
                        w={260}
                        withArrow
                      >
                        <IconHelpCircle size={16} color="#B45309" />
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  )
}
