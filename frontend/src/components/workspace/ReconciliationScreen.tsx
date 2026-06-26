import { useEffect, useMemo, useRef, useState } from 'react'
import { Anchor, Box, Button, Group, Table, Text, Textarea, Tooltip } from '@mantine/core'
import {
  IconArrowsLeftRight,
  IconCheck,
  IconFileText,
  IconHelpCircle,
  IconLoader2,
} from '@tabler/icons-react'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { api } from '../../api/client'
import { useSetQueryStatus } from '../../api/hooks'
import { formatAud } from '../../api/format'
import type { ClientQuery, JobDetail, ReconTxn } from '../../api/types'
import { RailDivider, RailGroupLabel, RailItem, RailShell } from './rail'
import { tokens } from '../../theme'

const QUERY_DOT: Record<string, string> = {
  pending: 'var(--am)',
  sent: 'var(--gr)',
  dismissed: 'var(--i4)',
}

// Reconciliation screen (spec §6a, §7a). Rail scopes everything to one bank
// account: Bank accounts → Views → Client queries. Selecting a rail item filters
// the table. Selecting a query also opens an inline draft strip above the table.
export type ReconView = 'all' | 'matched' | 'unmatched' | `q:${string}`

// An external nudge (from the fund-totals strip) to focus a specific account /
// view. `n` is a nonce so repeating the same focus still re-applies.
export interface ReconFocus {
  acct: string | null
  view: ReconView
  n: number
}

export interface ReconciliationScreenProps {
  job: JobDetail
  editable: boolean
  focus?: ReconFocus
}

type View = ReconView

function txnAmount(t: ReconTxn): number | null {
  return t.credit ?? (t.debit != null ? -t.debit : null)
}

// Matched documents are usually approved workpaper files (link to open them);
// some are bank-account references (e.g. "Ord Minnett Cash Account (…)") with no
// file behind them — show those as plain text.
function isFileLike(name: string): boolean {
  return /\.(pdf|png|jpe?g|csv|xlsx?|docx?|txt)$/i.test(name.trim())
}

function QueryDraft({
  jobId,
  query,
  accountNumber,
  editable,
}: {
  jobId: string
  query: ClientQuery
  accountNumber: string
  editable: boolean
}) {
  const [text, setText] = useState(query.query_text)
  const setStatus = useSetQueryStatus(jobId)

  const here = query.transactions.filter((t) => t.account_number === accountNumber).length
  const total = query.transactions.length
  const elsewhere = total - here

  function act(status: 'sent' | 'dismissed') {
    setStatus.mutate(
      { queryId: query.id, payload: { status, query_text: text } },
      {
        onSuccess: () =>
          notifications.show({
            color: status === 'sent' ? 'teal' : 'gray',
            title: status === 'sent' ? 'Query sent' : 'Query dismissed',
            message: query.category,
          }),
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
    <Box
      mb={12}
      style={{
        background: tokens.amberTint,
        border: `1px solid var(--am)`,
        borderRadius: 8,
        padding: 14,
      }}
    >
      <Group justify="space-between" align="center" mb={8} wrap="nowrap">
        <Group gap={8} wrap="nowrap">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: QUERY_DOT[query.status] ?? 'var(--i4)',
            }}
          />
          <Text fz={13.5} fw={600} c={tokens.textPrimary}>
            {query.category}
          </Text>
          <Text fz={12} c={tokens.textTertiary} tt="capitalize">
            · {query.status}
          </Text>
        </Group>
      </Group>

      <Textarea
        size="xs"
        autosize
        minRows={2}
        maxRows={8}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        disabled={!editable}
      />

      {elsewhere > 0 && (
        <Text fz={11.5} c={tokens.warn} mt={8}>
          {here} of {total} transactions are on this account · {elsewhere} on others — switch accounts
        </Text>
      )}

      {editable && (
        <Group justify="flex-end" gap="sm" mt={10}>
          <Button
            variant="default"
            size="compact-sm"
            loading={setStatus.isPending}
            onClick={confirmDismiss}
          >
            Dismiss
          </Button>
          <Button
            color="brand"
            size="compact-sm"
            loading={setStatus.isPending}
            onClick={() => act('sent')}
          >
            Send to client
          </Button>
        </Group>
      )}
    </Box>
  )
}

export function ReconciliationScreen({ job, editable, focus }: ReconciliationScreenProps) {
  const running = job.status === 'processing_review'
  const p2 = job.phase2_context
  const accounts = useMemo(() => Object.values(p2?.reconciliation_results ?? {}), [p2])
  const queries = p2?.queries ?? []

  const [acctNum, setAcctNum] = useState<string>(() => accounts[0]?.account_number ?? '')
  const [view, setView] = useState<View>('all')

  // Apply an external focus (from the fund-totals strip) once per nonce.
  const lastFocus = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!focus || focus.n === lastFocus.current) return
    lastFocus.current = focus.n
    if (focus.acct) setAcctNum(focus.acct)
    setView(focus.view)
  }, [focus])

  const account =
    accounts.find((a) => a.account_number === acctNum) ?? accounts[0]

  if (accounts.length === 0) {
    return (
      <Box style={{ flex: 1, padding: '18px 20px', minWidth: 0 }}>
        {running && <ReconcilingBanner />}
        <Text fz={13} c={tokens.textTertiary} mt={running ? 'md' : 0}>
          No reconciliation data yet.
        </Text>
      </Box>
    )
  }

  const acctTxns = account?.transactions ?? []
  const matchedCount = acctTxns.filter((t) => t.status === 'matched').length
  const unmatchedCount = acctTxns.length - matchedCount

  // Queries that touch the selected account.
  const acctQueries = queries
    .map((q) => ({
      q,
      here: q.transactions.filter((t) => t.account_number === account?.account_number).length,
    }))
    .filter(({ here }) => here > 0)

  const activeQuery =
    view.startsWith('q:') ? queries.find((q) => q.id === view.slice(2)) ?? null : null

  // Rows shown in the table for the current view.
  let rows: ReconTxn[]
  if (activeQuery) {
    rows = activeQuery.transactions.filter((t) => t.account_number === account?.account_number)
  } else if (view === 'matched') {
    rows = acctTxns.filter((t) => t.status === 'matched')
  } else if (view === 'unmatched') {
    rows = acctTxns.filter((t) => t.status !== 'matched')
  } else {
    rows = acctTxns
  }

  const viewLabel = activeQuery
    ? activeQuery.category
    : view === 'matched'
      ? 'Matched'
      : view === 'unmatched'
        ? 'Unmatched'
        : 'All transactions'

  return (
    <Box style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
      <RailShell>
        <RailGroupLabel label="Bank accounts" count={accounts.length} />
        {accounts.map((a) => (
          <RailItem
            key={a.account_number}
            label={a.account_name}
            count={a.transactions.length}
            active={a.account_number === account?.account_number}
            onClick={() => {
              setAcctNum(a.account_number)
              setView('all')
            }}
          />
        ))}

        <RailDivider />
        <RailGroupLabel label="Views" scope={account?.account_name} />
        <RailItem
          label="All transactions"
          count={acctTxns.length}
          active={view === 'all'}
          onClick={() => setView('all')}
        />
        <RailItem
          label="Matched"
          count={matchedCount}
          countColor={tokens.success}
          active={view === 'matched'}
          onClick={() => setView('matched')}
        />
        <RailItem
          label="Unmatched"
          count={unmatchedCount}
          countColor={tokens.warn}
          active={view === 'unmatched'}
          onClick={() => setView('unmatched')}
        />

        {acctQueries.length > 0 && (
          <>
            <RailDivider />
            <RailGroupLabel label="Client queries" scope={account?.account_name} />
            {acctQueries.map(({ q, here }) => (
              <RailItem
                key={q.id}
                label={q.category}
                dotColor={QUERY_DOT[q.status] ?? 'var(--i4)'}
                count={here === q.transactions.length ? here : `${here}/${q.transactions.length}`}
                active={view === `q:${q.id}`}
                onClick={() => setView(`q:${q.id}`)}
              />
            ))}
          </>
        )}
      </RailShell>

      <Box
        className="scroll-accent"
        style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: '14px 18px 20px' }}
      >
        {running && <ReconcilingBanner />}

        {activeQuery && account && (
          <QueryDraft
            key={`${activeQuery.id}-${account.account_number}`}
            jobId={job.job_id}
            query={activeQuery}
            accountNumber={account.account_number}
            editable={editable}
          />
        )}

        <Group justify="space-between" align="baseline" mb={10} mt={running ? 'sm' : 0}>
          <Text fz={14} fw={600} c={tokens.textPrimary} truncate>
            {viewLabel}
            {account ? (
              <Text component="span" fz={12.5} c={tokens.textTertiary} fw={400}>
                {'  ·  '}
                {account.account_number} · {account.account_name}
              </Text>
            ) : null}
          </Text>
          <Text fz={12} c={tokens.textTertiary} style={{ flexShrink: 0 }}>
            Showing {rows.length} of {acctTxns.length}
          </Text>
        </Group>

        <Table
          verticalSpacing={7}
          horizontalSpacing="sm"
          highlightOnHover
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: '14%' }}>Date</Table.Th>
              <Table.Th style={{ width: '54%' }}>Description</Table.Th>
              <Table.Th ta="right" style={{ width: '20%' }}>
                Amount
              </Table.Th>
              <Table.Th ta="center" style={{ width: '12%' }}>
                Match
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((t, i) => {
              const matched = t.status === 'matched'
              return (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Text fz={12.5}>{t.date}</Text>
                  </Table.Td>
                  <Table.Td style={{ wordBreak: 'break-word' }}>
                    <Text fz={12.5}>{t.description}</Text>
                    {!matched && t.unmatched_reason && (
                      <Text fz={11} c={tokens.warn} mt={1}>
                        {t.unmatched_reason}
                      </Text>
                    )}
                    {matched && t.matched_document && (() => {
                      const md = t.matched_document
                      // Inter-account transfer: the "document" is another bank
                      // account in this fund — link to jump to it.
                      const refAcct = !isFileLike(md)
                        ? accounts.find(
                            (a) =>
                              a.account_number &&
                              a.account_number !== account?.account_number &&
                              md.includes(a.account_number),
                          )
                        : undefined
                      return (
                        <Group gap={4} wrap="nowrap" mt={2} align="center">
                          {refAcct ? (
                            <IconArrowsLeftRight
                              size={11}
                              color="var(--tl)"
                              style={{ flexShrink: 0 }}
                            />
                          ) : (
                            <IconFileText size={11} color="var(--gr)" style={{ flexShrink: 0 }} />
                          )}
                          {isFileLike(md) ? (
                            <Anchor
                              href={api.fileUrl(job.job_id, 'workpaper', md)}
                              target="_blank"
                              fz={11}
                              c={tokens.accentTeal}
                              style={{ wordBreak: 'break-word' }}
                            >
                              {md}
                            </Anchor>
                          ) : refAcct ? (
                            <Anchor
                              component="button"
                              type="button"
                              fz={11}
                              c={tokens.accentTeal}
                              style={{ wordBreak: 'break-word', textAlign: 'left' }}
                              onClick={() => {
                                setAcctNum(refAcct.account_number)
                                setView('matched')
                              }}
                            >
                              {md}
                            </Anchor>
                          ) : (
                            <Text fz={11} c={tokens.textTertiary}>
                              {md}
                            </Text>
                          )}
                        </Group>
                      )
                    })()}
                  </Table.Td>
                  <Table.Td ta="right" className="tabular-nums">
                    <Text fz={12.5} c={t.credit != null ? tokens.success : tokens.textPrimary}>
                      {formatAud(txnAmount(t))}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="center">
                    {matched ? (
                      <IconCheck size={15} color="var(--gr)" />
                    ) : (
                      <Tooltip label={t.unmatched_reason ?? 'Unmatched'} multiline w={260} withArrow>
                        <IconHelpCircle size={15} color="var(--yl)" />
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Box>
    </Box>
  )
}

function ReconcilingBanner() {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: tokens.primaryTint,
        border: `1px solid var(--ab)`,
        borderRadius: 8,
        padding: '10px 14px',
      }}
    >
      <IconLoader2 size={16} color="var(--tl)" className="wf-spin" />
      <Text fz={12.5} c={tokens.accentTeal}>
        AI reviewer is reconciling balances — results will populate as they complete.
      </Text>
    </Box>
  )
}
