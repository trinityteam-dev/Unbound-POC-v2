import { Table, Text } from '@mantine/core'
import type { UnprocessedFile } from '../../api/types'
import { tokens } from '../../theme'
import { Card } from '../ui/Card'

export function UnprocessedCard({ files }: { files: UnprocessedFile[] | undefined }) {
  if (!files || files.length === 0) return null

  return (
    <Card title={`File Exceptions (${files.length})`} titleColor={tokens.warn} accent="amber">
      <Table verticalSpacing="sm" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Filename</Table.Th>
            <Table.Th>Reason</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {files.map((f, i) => (
            <Table.Tr key={`${f.filename}-${i}`}>
              <Table.Td>
                <Text fz={13}>{f.filename}</Text>
              </Table.Td>
              <Table.Td>
                <Text fz={12.5} c={tokens.textTertiary}>
                  {f.reason}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  )
}
