import { Accordion, Badge, Stack, Text } from '@mantine/core'
import type { AuditorNote, JobDetail } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

type Any = Record<string, unknown>

function ChecklistCard({ checklist }: { checklist: Any | undefined }) {
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
            const entries = items && typeof items === 'object' ? Object.keys(items as Any) : []
            return (
              <Accordion.Item key={group} value={group}>
                <Accordion.Control>
                  <Text fz={13.5} fw={500}>
                    {group}{' '}
                    <Text span fz={12} c={tokens.textTertiary}>
                      ({entries.length})
                    </Text>
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={6}>
                    {entries.map((item) => (
                      <Text key={item} fz={12.5} c={tokens.textSecondary}>
                        • {item}
                      </Text>
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
      <ChecklistCard checklist={checklist} />
      <NotesBoard job={job} />
    </Stack>
  )
}
