import { Accordion, Anchor, Badge, Box, Group, Stack, Text } from '@mantine/core'
import {
  IconCircleCheck,
  IconExclamationCircle,
  IconFileText,
  IconHelpCircle,
  IconMinus,
} from '@tabler/icons-react'
import { api } from '../../api/client'
import type { AuditorNote, JobDetail } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

type Any = Record<string, unknown>

interface ChecklistEntry {
  files?: string[]
  notes?: string
  status?: string
}

// Map an engine status to colour + icon. Verified/Missing/N/A are the known
// values; anything else falls back to an amber "other" treatment.
function statusMeta(status?: string) {
  const s = (status ?? '').trim().toLowerCase()
  if (s === 'verified') return { color: tokens.success, label: 'Verified', Icon: IconCircleCheck }
  if (s === 'missing') return { color: tokens.danger, label: 'Missing', Icon: IconExclamationCircle }
  if (s === 'n/a' || s === 'na') return { color: tokens.textTertiary, label: 'N/A', Icon: IconMinus }
  return { color: tokens.warn, label: status || 'Unknown', Icon: IconHelpCircle }
}

function ChecklistRow({
  jobId,
  name,
  entry,
}: {
  jobId: string
  name: string
  entry: ChecklistEntry
}) {
  const meta = statusMeta(entry.status)
  const files = entry.files ?? []
  return (
    <Box>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap={8} align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
          <meta.Icon size={15} color={meta.color} style={{ flexShrink: 0, marginTop: 1 }} />
          <Text fz={13} fw={500} c={tokens.textPrimary}>
            {name}
          </Text>
        </Group>
        <Text fz={11.5} fw={600} c={meta.color} style={{ flexShrink: 0 }}>
          {meta.label}
        </Text>
      </Group>

      {files.length > 0 && (
        <Group gap={6} mt={3} pl={23} wrap="wrap">
          <IconFileText size={12} color={tokens.textTertiary} style={{ flexShrink: 0 }} />
          {files.map((f, i) => (
            <Anchor
              key={`${f}-${i}`}
              href={api.fileUrl(jobId, 'workpaper', f)}
              target="_blank"
              fz={12}
              c={tokens.accentTeal}
              style={{ wordBreak: 'break-word' }}
            >
              {f}
            </Anchor>
          ))}
        </Group>
      )}

      {entry.notes && (
        <Text fz={12} c={tokens.textTertiary} mt={2} pl={23}>
          {entry.notes}
        </Text>
      )}
    </Box>
  )
}

function ChecklistCard({ jobId, checklist }: { jobId: string; checklist: Any | undefined }) {
  const groups = checklist ? Object.entries(checklist) : []
  return (
    <Card title="Document Audit Checklist Verification" accent="violet">
      {groups.length === 0 ? (
        <Text fz={13} c={tokens.textTertiary}>
          No checklist available.
        </Text>
      ) : (
        <Accordion variant="separated" radius="md">
          {groups.map(([group, items]) => {
            const entries =
              items && typeof items === 'object'
                ? (Object.entries(items as Record<string, ChecklistEntry>) as [
                    string,
                    ChecklistEntry,
                  ][])
                : []
            const verified = entries.filter(
              ([, v]) => (v.status ?? '').toLowerCase() === 'verified',
            ).length
            const missing = entries.filter(
              ([, v]) => (v.status ?? '').toLowerCase() === 'missing',
            ).length
            return (
              <Accordion.Item key={group} value={group}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" pr={8}>
                    <Text fz={13.5} fw={500}>
                      {group}{' '}
                      <Text span fz={12} c={tokens.textTertiary}>
                        ({entries.length})
                      </Text>
                    </Text>
                    <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
                      {verified > 0 && (
                        <Text fz={11.5} c={tokens.success}>
                          {verified} verified
                        </Text>
                      )}
                      {missing > 0 && (
                        <Text fz={11.5} c={tokens.danger}>
                          {missing} missing
                        </Text>
                      )}
                    </Group>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={12}>
                    {entries.map(([item, entry]) => (
                      <ChecklistRow key={item} jobId={jobId} name={item} entry={entry} />
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>
      )}
    </Card>
  )
}

function NotesBoard({ job }: { job: JobDetail }) {
  const auditorNotes = (job.auditor_notes as AuditorNote[] | undefined) ?? []
  return (
    <Card title="Notes & Exceptions" accent="amber">
      <Stack gap="md">
        {job.processor_notes ? (
          <div>
            <Text fz={12.5} fw={600} c={tokens.textSecondary}>
              Processor notes
            </Text>
            <Text fz={13}>{job.processor_notes}</Text>
          </div>
        ) : null}
        {job.reviewer_notes ? (
          <div>
            <Text fz={12.5} fw={600} c={tokens.textSecondary}>
              Reviewer notes
            </Text>
            <Text fz={13}>{job.reviewer_notes}</Text>
          </div>
        ) : null}

        <div>
          <Text fz={12.5} fw={600} c={tokens.textSecondary} mb={6}>
            Auditor exceptions ({auditorNotes.length})
          </Text>
          {auditorNotes.length === 0 ? (
            <Text fz={13} c={tokens.textTertiary}>
              No exceptions found. Ledger is clean.
            </Text>
          ) : (
            <Stack gap="sm">
              {auditorNotes.map((n, i) => (
                <div
                  key={i}
                  style={{
                    borderLeft: `3px solid ${n.type === 'warning' ? '#F59E0B' : '#DC2626'}`,
                    paddingLeft: 12,
                  }}
                >
                  <Badge
                    color={n.type === 'warning' ? 'yellow' : 'red'}
                    variant="light"
                    radius="xl"
                    size="xs"
                    tt="capitalize"
                  >
                    {n.type}
                  </Badge>
                  <Text fz={13} fw={500} mt={3}>
                    {n.title}
                  </Text>
                  <Text fz={12.5} c={tokens.textTertiary}>
                    {n.description}
                  </Text>
                </div>
              ))}
            </Stack>
          )}
        </div>
      </Stack>
    </Card>
  )
}

export function Compliance({ job }: { job: JobDetail }) {
  const checklist = (job.results?.checklist as Any) ?? undefined
  return (
    <Stack gap="lg">
      <ChecklistCard jobId={job.job_id} checklist={checklist} />
      <NotesBoard job={job} />
    </Stack>
  )
}
