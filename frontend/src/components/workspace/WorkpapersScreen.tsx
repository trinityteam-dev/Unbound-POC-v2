import { Fragment, useMemo, useState } from 'react'
import {
  Anchor,
  Box,
  Button,
  Group,
  Select,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { api } from '../../api/client'
import { formatMoney, formatShortDate } from '../../api/format'
import { isApprovedFile, type JobDetail, type JobFile, type UnprocessedFile } from '../../api/types'
import { RailDivider, RailGroupLabel, RailItem, RailShell } from './rail'
import { tokens } from '../../theme'

const SPLIT_MARKER = '[Split and grouped by account]'

// Workpapers screen (spec §6b, §7b). Rail = Views + Categories; table = classified
// documents. Phase 1 is editable (inline override); phase 2/3 is read-only evidence.
export interface WorkpapersScreenProps {
  job: JobDetail
  files: JobFile[]
  editable: boolean
  onApplyOverride: (index: number, patch: Partial<JobFile> & { approve?: boolean }) => void
}

type Filter =
  | { kind: 'all' }
  | { kind: 'approved' }
  | { kind: 'pending' }
  | { kind: 'exceptions' }
  | { kind: 'category'; value: string }

function extractedData(f: JobFile): string {
  const parts: string[] = []
  if (f.account_number) parts.push(`Acct ${f.account_number}`)
  const amount = formatMoney(f.amount)
  if (amount !== '—') parts.push(amount)
  const date = formatShortDate(f.date)
  if (date !== '—') parts.push(date)
  return parts.length ? parts.join(' · ') : '—'
}

interface OverrideDraft {
  category: string
  account_number: string
  amount: string
  date: string
  notes: string
}

function InlineOverride({
  file,
  categories,
  onCancel,
  onApply,
}: {
  file: JobFile
  categories: string[]
  onCancel: () => void
  onApply: (draft: OverrideDraft) => void
}) {
  const [draft, setDraft] = useState<OverrideDraft>({
    category: file.category ?? '',
    account_number: file.account_number ?? '',
    amount: file.amount ?? '',
    date: file.date ?? '',
    notes: 'notes' in file ? (file.notes ?? '') : '',
  })
  const options = Array.from(new Set([...categories, draft.category].filter(Boolean)))

  return (
    <Box
      style={{
        background: tokens.amberTint,
        border: `1px solid ${tokens.hairline}`,
        borderRadius: 8,
        padding: 14,
        margin: '4px 0',
      }}
    >
      <Group grow align="flex-start" gap="sm">
        <Select
          label="Category"
          size="xs"
          data={options}
          value={draft.category}
          onChange={(v) => setDraft((d) => ({ ...d, category: v ?? '' }))}
          searchable
        />
        <TextInput
          label="Account number"
          size="xs"
          value={draft.account_number}
          onChange={(e) => setDraft((d) => ({ ...d, account_number: e.currentTarget.value }))}
        />
        <TextInput
          label="Amount"
          size="xs"
          placeholder="270.41"
          value={draft.amount}
          onChange={(e) => setDraft((d) => ({ ...d, amount: e.currentTarget.value }))}
        />
        <TextInput
          label="Date"
          size="xs"
          placeholder="30.06.25"
          value={draft.date}
          onChange={(e) => setDraft((d) => ({ ...d, date: e.currentTarget.value }))}
        />
      </Group>
      <Textarea
        label="Notes"
        size="xs"
        mt="xs"
        autosize
        minRows={2}
        value={draft.notes}
        onChange={(e) => setDraft((d) => ({ ...d, notes: e.currentTarget.value }))}
      />
      <Group justify="flex-end" gap="sm" mt="sm">
        <Button variant="default" size="compact-sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="brand" size="compact-sm" onClick={() => onApply(draft)}>
          Approve &amp; apply
        </Button>
      </Group>
    </Box>
  )
}

export function WorkpapersScreen({ job, files, editable, onApplyOverride }: WorkpapersScreenProps) {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const unprocessed: UnprocessedFile[] = job.unprocessed_files ?? []
  const approvedCount = files.filter(isApprovedFile).length
  const pendingCount = files.length - approvedCount

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of files) {
      if (f.category) m.set(f.category, (m.get(f.category) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [files])

  const allCategories = categoryCounts.map(([c]) => c)

  // Rows for the current filter (with original index preserved for override).
  const rows = useMemo(
    () =>
      files
        .map((f, idx) => ({ f, idx }))
        .filter(({ f }) => {
          switch (filter.kind) {
            case 'approved':
              return isApprovedFile(f)
            case 'pending':
              return !isApprovedFile(f)
            case 'category':
              return f.category === filter.value
            case 'exceptions':
              return false
            default:
              return true
          }
        }),
    [files, filter],
  )

  function railActive(f: Filter): boolean {
    if (f.kind === 'category' && filter.kind === 'category') return f.value === filter.value
    return f.kind === filter.kind
  }

  const showExceptions = filter.kind === 'exceptions'
  const titleLabel =
    filter.kind === 'all'
      ? 'All documents'
      : filter.kind === 'approved'
        ? 'Approved'
        : filter.kind === 'pending'
          ? 'Pending review'
          : filter.kind === 'exceptions'
            ? 'Exceptions'
            : filter.value
  const shownCount = showExceptions ? unprocessed.length : rows.length

  return (
    <Box style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
      <RailShell>
        <RailGroupLabel label="Views" />
        <RailItem
          label="All documents"
          count={files.length}
          active={railActive({ kind: 'all' })}
          onClick={() => setFilter({ kind: 'all' })}
        />
        <RailItem
          label="Approved"
          count={approvedCount}
          countColor={tokens.success}
          active={railActive({ kind: 'approved' })}
          onClick={() => setFilter({ kind: 'approved' })}
        />
        {editable && (
          <RailItem
            label="Pending review"
            count={pendingCount}
            countColor={tokens.warn}
            active={railActive({ kind: 'pending' })}
            onClick={() => setFilter({ kind: 'pending' })}
          />
        )}
        {unprocessed.length > 0 && (
          <RailItem
            label="Exceptions"
            count={unprocessed.length}
            countColor={tokens.danger}
            active={railActive({ kind: 'exceptions' })}
            onClick={() => setFilter({ kind: 'exceptions' })}
          />
        )}

        {categoryCounts.length > 0 && (
          <>
            <RailDivider />
            <RailGroupLabel label="Categories" />
            {categoryCounts.map(([cat, n]) => (
              <RailItem
                key={cat}
                label={cat}
                count={n}
                active={railActive({ kind: 'category', value: cat })}
                onClick={() => setFilter({ kind: 'category', value: cat })}
              />
            ))}
          </>
        )}
      </RailShell>

      <Box
        className="scroll-accent"
        style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: '14px 18px 20px' }}
      >
        <Group justify="space-between" align="baseline" mb={10}>
          <Text fz={14} fw={600} c={tokens.textPrimary}>
            {titleLabel}
          </Text>
          <Text fz={12} c={tokens.textTertiary}>
            {showExceptions
              ? `${shownCount} unprocessed`
              : `Showing ${shownCount} of ${files.length}`}
          </Text>
        </Group>

        {showExceptions ? (
          <Table verticalSpacing="sm" horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Filename</Table.Th>
                <Table.Th>Reason</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {unprocessed.map((u, i) => (
                <Table.Tr key={`${u.filename}-${i}`}>
                  <Table.Td>
                    <Text fz={13}>{u.filename}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz={12.5} c={tokens.textTertiary}>
                      {u.reason}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : rows.length === 0 ? (
          <Text fz={13} c={tokens.textTertiary} py="md">
            No documents in this view.
          </Text>
        ) : (
          <Table
            verticalSpacing="sm"
            horizontalSpacing="sm"
            highlightOnHover
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: '26%' }}>Document</Table.Th>
                <Table.Th style={{ width: '30%' }}>Category</Table.Th>
                <Table.Th style={{ width: '18%' }}>Extracted</Table.Th>
                <Table.Th style={{ width: '10%' }}>Status</Table.Th>
                {editable && <Table.Th style={{ width: '16%' }} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ f, idx }) => {
                const approved = isApprovedFile(f)
                const phase = approved ? 'workpaper' : 'staging'
                const isRealFile = !!f.classified_name && f.classified_name !== SPLIT_MARKER
                const editing = editIdx === idx
                return (
                  <Fragment key={`${f.classified_name}-${idx}`}>
                    <Table.Tr>
                      <Table.Td style={{ wordBreak: 'break-word' }}>
                        {isRealFile ? (
                          <Anchor
                            href={api.fileUrl(job.job_id, phase, f.classified_name)}
                            target="_blank"
                            fz={13}
                            c={tokens.accentTeal}
                          >
                            {f.classified_name}
                          </Anchor>
                        ) : (
                          <Text fz={13}>{f.classified_name}</Text>
                        )}
                        <Text fz={11.5} c={tokens.textTertiary} truncate>
                          {f.original_name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text fz={13}>{f.category}</Text>
                      </Table.Td>
                      <Table.Td style={{ wordBreak: 'break-word' }}>
                        <Text fz={12.5} c={tokens.textSecondary} className="tabular-nums">
                          {extractedData(f)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text fz={13} fw={500} c={approved ? tokens.success : tokens.warn}>
                          {approved ? 'Approved' : 'Pending'}
                        </Text>
                      </Table.Td>
                      {editable && (
                        <Table.Td>
                          <Button
                            variant="subtle"
                            color="brand"
                            size="compact-xs"
                            onClick={() => setEditIdx(editing ? null : idx)}
                          >
                            {editing ? 'Close' : 'Override'}
                          </Button>
                        </Table.Td>
                      )}
                    </Table.Tr>
                    {editing && editable && (
                      <Table.Tr>
                        <Table.Td colSpan={5} style={{ padding: 0, border: 'none' }}>
                          <InlineOverride
                            file={f}
                            categories={allCategories}
                            onCancel={() => setEditIdx(null)}
                            onApply={(draft) => {
                              onApplyOverride(idx, {
                                category: draft.category,
                                account_number: draft.account_number || null,
                                amount: draft.amount || null,
                                date: draft.date || null,
                                notes: draft.notes,
                                approve: true,
                              } as Partial<JobFile> & { approve?: boolean })
                              setEditIdx(null)
                            }}
                          />
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                )
              })}
            </Table.Tbody>
          </Table>
        )}

        {!editable && (
          <Box
            mt="md"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(96,165,250,0.10)',
              border: `1px solid rgba(96,165,250,0.30)`,
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <Text fz={12.5} c={tokens.blue}>
              🔒 Approved during Step 1 · read-only evidence for this reconciliation
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
