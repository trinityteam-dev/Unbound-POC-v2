import { Badge, Box, Divider, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core'
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
    <Card title="Cash Lead Schedule" accent="teal">
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
  // Data-driven: one entry per holding/distribution the AI could actually
  // cross-reference in this fund's documents — not a single hardcoded security.
  const holdings = (portfolio?.holdings_reconciliation as Any[]) ?? []
  const distChecks = (portfolio?.distribution_checks as Any[]) ?? []

  if (holdings.length === 0 && distChecks.length === 0) {
    return (
      <Card title="Securities Portfolio Valuation" accent="teal">
        <Text fz={13} c={tokens.textTertiary}>
          No cross-referenceable holdings found (needs both a broker/registry document and a
          tax/periodic statement for the same security).
        </Text>
      </Card>
    )
  }

  return (
    <Card title="Securities Portfolio Valuation" accent="teal">
      <Stack gap="md">
        {holdings.map((h, i) => {
          const variance =
            typeof h.broker_market_value === 'number' && typeof h.registry_market_value === 'number'
              ? h.broker_market_value - h.registry_market_value
              : null
          return (
            <Box key={`holding-${i}`}>
              <Text fz={13} fw={500} c={tokens.textSecondary} mb={4}>
                {String(h.security_name ?? 'Holding')} — registry check
              </Text>
              <DefRow label="Broker market value" value={money(h.broker_market_value)} />
              <DefRow label="Registry market value" value={money(h.registry_market_value)} />
              {variance != null && variance !== 0 && (
                <Text fz={12.5} c={tokens.warn} mt={4}>
                  ⚠ Pricing variance of {formatAud(Math.abs(variance))} between broker and registry.
                </Text>
              )}
            </Box>
          )
        })}

        {distChecks.map((d, i) => {
          const pass = String(d.reconciliation ?? '').toLowerCase() === 'pass'
          return (
            <Box key={`dist-${i}`}>
              <Group gap={8} mb={4}>
                <Text fz={13} fw={500} c={tokens.textSecondary}>
                  {String(d.security_name ?? 'Distribution')} check
                </Text>
                <Badge color={pass ? 'green' : 'red'} variant="light" radius="xl" size="sm">
                  {String(d.reconciliation ?? 'n/a')}
                </Badge>
              </Group>
              <DefRow label="Tax statement distribution" value={money(d.tax_statement_distribution)} />
              <DefRow
                label="Periodic statement distribution"
                value={money(d.periodic_statement_distribution)}
              />
            </Box>
          )
        })}
      </Stack>
    </Card>
  )
}

function TaxCard({ tax }: { tax: Any | undefined }) {
  const accounts = (tax?.accounts as Any[]) ?? []
  const outstanding = (tax?.outstanding_returns as Any) ?? {}
  return (
    <Card title="ATO Tax Reconciliation Ledger" accent="teal">
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

function MemberCard({ members }: { members: Any[] }) {
  if (members.length === 0) {
    return (
      <Card title="Member Total Superannuation Balance (TSB)" accent="teal">
        <Text fz={13} c={tokens.textTertiary}>
          No member data.
        </Text>
      </Card>
    )
  }
  return (
    <Card title="Member Total Superannuation Balance (TSB)" accent="teal">
      <Stack gap="md">
        {members.map((member, i) => (
          <Box key={i}>
            {i > 0 && <Divider mb="sm" />}
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
          </Box>
        ))}
      </Stack>
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
  // Backend now returns an array (one entry per fund member); tolerate a lone object too,
  // in case older cached job results predate the change.
  const rawMembers = results.member_reconciliation
  const members = Array.isArray(rawMembers) ? (rawMembers as Any[]) : rawMembers ? [rawMembers as Any] : []

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      <CashCard cash={results.cash_reconciliation as Any} />
      <SecuritiesCard portfolio={results.portfolio_reconciliation as Any} />
      <TaxCard tax={results.tax_reconciliation as Any} />
      <MemberCard members={members} />
    </SimpleGrid>
  )
}
