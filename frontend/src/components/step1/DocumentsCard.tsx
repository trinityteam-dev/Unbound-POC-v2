import { Anchor, Button, Table, Text } from '@mantine/core'
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

export function DocumentsCard({ jobId, files, editable, onOverride }: DocumentsCardProps) {
  const approved = files.filter(isApprovedFile).length

  return (
    <Card
      title="Classified Audit Workpapers"
      action={
        <Text fz={12.5} c={tokens.textTertiary}>
          {approved} of {files.length} approved
        </Text>
      }
    >
      {files.length === 0 ? (
        <Text fz={13.5} c={tokens.textTertiary} py="md">
          No documents classified.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table
            verticalSpacing="sm"
            horizontalSpacing="sm"
            highlightOnHover
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: editable ? '30%' : '34%' }}>Document</Table.Th>
                <Table.Th style={{ width: '18%' }}>Category</Table.Th>
                <Table.Th ta="right" style={{ width: '12%' }}>
                  Amount
                </Table.Th>
                <Table.Th style={{ width: '10%' }}>Date</Table.Th>
                <Table.Th style={{ width: '13%' }}>Status</Table.Th>
                {editable && <Table.Th style={{ width: '17%' }} />}
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
                      <Text fz={11.5} c={tokens.textTertiary}>
                        {f.original_name}
                        {f.account_number ? ` · Acct ${f.account_number}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fz={13}>{f.category}</Text>
                    </Table.Td>
                    <Table.Td ta="right" className="tabular-nums">
                      <Text fz={13}>{formatMoney(f.amount)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fz={13}>{formatShortDate(f.date)}</Text>
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
