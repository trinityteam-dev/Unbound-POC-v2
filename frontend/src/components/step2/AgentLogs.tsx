import { useEffect, useRef } from 'react'
import { Box, Text } from '@mantine/core'
import { tokens } from '../../theme'

// Infer a log level from the line text for coloring.
function lineColor(line: string): string {
  const l = line.toLowerCase()
  if (/error|fail|exception|❌/.test(l)) return '#F87171'
  if (/warn|⚠|discrepan|variance|pending/.test(l)) return '#FBBF24'
  if (/complete|signed off|success|✓|done/.test(l)) return '#34D399'
  return 'rgba(255,255,255,.78)'
}

export function AgentLogs({ logs }: { logs: string[] | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  const lines = logs ?? []

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines.length])

  return (
    <Box
      style={{
        background: '#0E1116',
        borderRadius: 12,
        border: `1px solid ${tokens.hairline}`,
        boxShadow: tokens.shadowCard,
        overflow: 'hidden',
      }}
    >
      <Box px="lg" py="sm" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <Text fz={13} fw={600} c="rgba(255,255,255,.9)">
          Agent Execution Logs
        </Text>
      </Box>
      <div
        ref={ref}
        style={{
          maxHeight: 540,
          overflowY: 'auto',
          padding: '12px 20px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          lineHeight: 1.7,
        }}
      >
        {lines.length === 0 ? (
          <Text fz={12.5} c="rgba(255,255,255,.5)">
            No logs yet.
          </Text>
        ) : (
          lines.map((line, i) => (
            <div key={i} style={{ color: lineColor(line), whiteSpace: 'pre-wrap' }}>
              {line}
            </div>
          ))
        )}
      </div>
    </Box>
  )
}
