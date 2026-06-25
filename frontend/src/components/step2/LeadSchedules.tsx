import { Badge, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core'
import { formatAud } from '../../api/format'
import type { JobResults } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

// Lead-schedule data is loosely structured — read defensively.
type Any = Record<string, unknown>

function money(v: unknown): string {
  return typeof v === 'number' ? formatAud(v) : '—'
}

function DefRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '5px 0' }}>
      <Text fz={13} c={tokens.textSecondary}>
        {label}
      </Text>
      <Text fz={13} fw={500} c={color ?? tokens.textPrimary} className="tabular-nums" ta="right">
        {value}
      </Text>
    </div>
  )
}

function CashCard({ cash }: { cash: Any | undefined }) {
  const accounts = (cash?.accounts as Any[]) ?? []
  return (
    <Card title="Cash Lead Schedule">
      {accounts.length === 0 ? (
        <Text fz={13} c={tokens.textTertiary}>
          No cash accounts.
        </Text>
      ) : (
        <Table verticalSpacing="sm" horizontalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Account</Table.Th>
              <Table.Th ta="right">Opening</Table.Th>
              <Table.Th ta="right">Closing</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {accounts.map((a, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Text fz={13}>{String(a.name ?? '')}</Text>
                  <Text fz={11.5} c={tokens.textTertiary}>
                    {String(a.number ?? '')} · BSB {String(a.bsb ?? '—')}
                  </Text>
                </Table.Td>
                <Table.Td ta="right" className="tabular-nums">
                  <Text fz={13}>{money(a.opening_bal_1jul24)}</Text>
                </Table.Td>
                <Table.Td ta="right" className="tabular-nums">
                  <Text fz={13}>{money(a.closing_bal_30jun25)}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  )
}

function SecuritiesCard({ portfolio }: { portfolio: Any | undefined }) {
  const mxt = (portfolio?.mxt_reconciliation as Any) ?? {}
  const dist = (portfolio?.distribution_check as Any) ?? {}
  const variance =
    typeof mxt.broker_market_value === 'number' && typeof mxt.registry_market_value === 'number'
      ? mxt.broker_market_value - mxt.registry_market_value
      : null
  const distPass = String(dist.reconciliation ?? '').toLowerCase() === 'pass'

  return (
    <Card title="Securities Portfolio Valuation">
      <Text fz={13} fw={500} c={tokens.textSecondary} mb={4}>
        MXT registry check
      </Text>
      <DefRow label="Broker market value" value={money(mxt.broker_market_value)} />
      <DefRow label="Registry market value" value={money(mxt.registry_market_value)} />
      {variance != null && variance !== 0 && (
        <Text fz={12.5} c={tokens.warn} mt={4}>
          ⚠ Pricing variance of {formatAud(Math.abs(variance))} between broker and registry.
        </Text>
      )}

      <Group gap={8} mt="md" mb={4}>
        <Text fz={13} fw={500} c={tokens.textSecondary}>
          Distribution check
        </Text>
        <Badge color={distPass ? 'green' : 'red'} variant="light" radius="sm" size="sm">
          {String(dist.reconciliation ?? 'n/a')}
        </Badge>
      </Group>
      <DefRow label="Tax statement distribution" value={money(dist.mxt_tax_statement_distribution)} />
      <DefRow
        label="Periodic statement distribution"
        value={money(dist.mxt_periodic_statement_distribution)}
      />
    </Card>
  )
}

function TaxCard({ tax }: { tax: Any | undefined }) {
  const accounts = (tax?.accounts as Any[]) ?? []
  const outstanding = (tax?.outstanding_returns as Any) ?? {}
  return (
    <Card title="ATO Tax Reconciliation Ledger">
      <Stack gap={4}>
        {accounts.map((a, i) => (
          <DefRow
            key={i}
            label={String(a.name ?? '')}
            value={`${money(a.balance_30jun25)} · ${String(a.status ?? '')}`}
          />
        ))}
      </Stack>
      {outstanding.FY25 ? (
        <Text fz={12.5} c={tokens.warn} mt="sm">
          FY25 returns: {String(outstanding.FY25)}
          {outstanding.details ? ` — ${String(outstanding.details)}` : ''}
        </Text>
      ) : null}
    </Card>
  )
}

function MemberCard({ member }: { member: Any | undefined }) {
  if (!member) {
    return (
      <Card title="Member Total Superannuation Balance (TSB)">
        <Text fz={13} c={tokens.textTertiary}>
          No member data.
        </Text>
      </Card>
    )
  }
  return (
    <Card title="Member Total Superannuation Balance (TSB)">
      <Text fz={14} fw={500}>
        {String(member.name ?? '')}
      </Text>
      <DefRow label="TSB 2024" value={money(member.tsb_2024)} />
      <DefRow label="TSB 2025" value={money(member.tsb_2025)} />
      <DefRow label="Status" value={String(member.reconciliation_status ?? '—')} />
      {member.audit_finding ? (
        <Text fz={12.5} c={tokens.textTertiary} mt="sm">
          {String(member.audit_finding)}
        </Text>
      ) : null}
    </Card>
  )
}

export function LeadSchedules({ results }: { results: JobResults | null | undefined }) {
  if (!results) {
    return (
      <Text fz={13} c={tokens.textTertiary}>
        No lead schedules yet.
      </Text>
    )
  }
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      <CashCard cash={results.cash_reconciliation as Any} />
      <SecuritiesCard portfolio={results.portfolio_reconciliation as Any} />
      <TaxCard tax={results.tax_reconciliation as Any} />
      <MemberCard member={results.member_reconciliation as Any} />
    </SimpleGrid>
  )
}
