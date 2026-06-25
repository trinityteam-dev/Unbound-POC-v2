import { Anchor, Badge, Button, Table, Text } from '@mantine/core'
import { api } from '../../api/client'
import { formatMoney, formatShortDate } from '../../api/format'
import { isApprovedFile, type JobFile } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

const SPLIT_MARKER = '[Split and grouped by account]'

export interface DocumentsCardProps {
  jobId: string
  files: JobFile[]
  editable: boolean
  onOverride: (index: number) => void
}

// Consolidate the extracted metadata (account / amount / date) into one cell.
function extractedData(f: JobFile): string {
  const parts: string[] = []
  if (f.account_number) parts.push(`Acct ${f.account_number}`)
  const amount = formatMoney(f.amount)
  if (amount !== '—') parts.push(amount)
  const date = formatShortDate(f.date)
  if (date !== '—') parts.push(date)
  return parts.length ? parts.join(' · ') : '—'
}

export function DocumentsCard({ jobId, files, editable, onOverride }: DocumentsCardProps) {
  const approved = files.filter(isApprovedFile).length
  const allApproved = files.length > 0 && approved === files.length

  return (
    <Card
      title="Classified Audit Workpapers"
      accent="teal"
      divider
      action={
        <Badge
          color={allApproved ? 'teal' : 'gray'}
          variant="light"
          radius="sm"
          size="md"
        >
          {approved} of {files.length} approved
        </Badge>
      }
    >
      {files.length === 0 ? (
        <Text fz={13.5} c={tokens.textTertiary} py="md">
          No documents classified.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={620}>
          <Table
            verticalSpacing="sm"
            horizontalSpacing="sm"
            highlightOnHover
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: editable ? '22%' : '25%' }}>Document</Table.Th>
                <Table.Th style={{ width: '20%' }}>Original File</Table.Th>
                <Table.Th style={{ width: '16%' }}>Category</Table.Th>
                <Table.Th style={{ width: '20%' }}>Extracted Data</Table.Th>
                <Table.Th style={{ width: '10%' }}>Status</Table.Th>
                {editable && <Table.Th style={{ width: '12%' }} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {files.map((f, i) => {
                const isApprovedRow = isApprovedFile(f)
                const phase = isApprovedRow ? 'workpaper' : 'staging'
                const isRealFile = !!f.classified_name && f.classified_name !== SPLIT_MARKER
                return (
                  <Table.Tr
                    key={`${f.classified_name}-${i}`}
                    style={{ background: isApprovedRow ? undefined : tokens.amberTint }}
                  >
                    <Table.Td style={{ wordBreak: 'break-word' }}>
                      {isRealFile ? (
                        <Anchor
                          href={api.fileUrl(jobId, phase, f.classified_name)}
                          target="_blank"
                          fz={13.5}
                        >
                          {f.classified_name}
                        </Anchor>
                      ) : (
                        <Text fz={13.5}>{f.classified_name}</Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ wordBreak: 'break-word' }}>
                      <Text fz={12.5} c={tokens.textSecondary}>
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
                      <Text fz={13} fw={500} c={isApprovedRow ? tokens.success : tokens.warn}>
                        {isApprovedRow ? 'Approved' : 'Pending'}
                      </Text>
                    </Table.Td>
                    {editable && (
                      <Table.Td>
                        <Button
                          variant="subtle"
                          color="brand"
                          size="compact-sm"
                          onClick={() => onOverride(i)}
                        >
                          Override
                        </Button>
                      </Table.Td>
                    )}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}
