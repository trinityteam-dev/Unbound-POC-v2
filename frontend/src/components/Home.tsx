import { Box, Center, Loader } from '@mantine/core'
import {
  IconArrowRight,
  IconBell,
  IconChevronRight,
  IconPlus,
} from '@tabler/icons-react'
import type { Job, JobStatus } from '../api/types'
import { getModelLabel } from '../api/format'
import { useModels } from '../api/hooks'
import { statusDotColor, statusMeta } from '../lib/status'
import { tokens } from '../theme'
import { FundDiscoveryBanner } from './FundDiscoveryBanner'

export interface HomeProps {
  jobs: Job[] | undefined
  isLoading: boolean
  onSelectJob: (jobId: string) => void
  onNewAudit: () => void
}

const NEEDS_REVIEW: JobStatus[] = ['pending_processor_review', 'pending_reviewer_approval']
const PROCESSING: JobStatus[] = ['processing_docs', 'processing_review']

// Status pill colors, drawn from the SuperRecords palette tokens so they
// follow the light/dark toggle.
function pillStyle(status: JobStatus): React.CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    pending_reviewer_approval: { bg: 'var(--at)', fg: 'var(--am)' },
    pending_processor_review: { bg: 'rgba(79,105,163,0.12)', fg: 'var(--bl)' },
    completed: { bg: 'var(--tn)', fg: 'var(--tl)' },
  }
  const c = map[status] ?? { bg: 'var(--hv)', fg: 'var(--i2)' }
  return {
    background: c.bg,
    color: c.fg,
    fontSize: 10.5,
    fontWeight: 600,
    padding: '3px 9px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  }
}

// Quiet "which engine ran this" tag, sat right next to the fund name.
const modelTagStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: tokens.textTertiary,
  background: tokens.strip,
  border: `1px solid ${tokens.hairline}`,
  padding: '1px 7px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: tokens.surface,
        borderRadius: 12,
        border: `1px solid ${tokens.accentBorder}`,
        overflow: 'hidden',
      }}
    >
      {children}
    </Box>
  )
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Box style={{ background: tokens.strip, borderRadius: 12, padding: '13px 15px' }}>
      <Box
        style={{
          fontSize: 11,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: tokens.textTertiary,
          fontWeight: 500,
        }}
      >
        {label}
      </Box>
      <Box style={{ fontSize: 25, fontWeight: 600, color: color ?? tokens.textPrimary, marginTop: 3 }}>
        {value}
      </Box>
    </Box>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <Box style={{ flex: 1, textAlign: 'center' }}>
      <Box style={{ fontSize: 12, fontWeight: 600, color: tokens.primaryGreen }}>{n}</Box>
      <Box style={{ fontSize: 11.5, color: tokens.textSecondary, marginTop: 1 }}>{label}</Box>
    </Box>
  )
}

export function Home({ jobs, isLoading, onSelectJob, onNewAudit }: HomeProps) {
  const models = useModels().data?.models

  if (isLoading) {
    return (
      <Pane>
        <Center h="100%">
          <Loader color="brand" />
        </Center>
      </Pane>
    )
  }

  const all = jobs ?? []
  const fundCount = new Set(all.map((j) => j.fund_id)).size
  const needsReview = all.filter((j) => NEEDS_REVIEW.includes(j.status))
  const processing = all.filter((j) => PROCESSING.includes(j.status)).length
  const completed = all.filter((j) => j.status === 'completed').length
  const attention = needsReview.slice(0, 5)

  return (
    <Pane>
      <Box className="scroll-accent" style={{ flex: 1, overflowY: 'auto', padding: '22px 24px' }}>
        {/* New fund folders dropped into data/ (Story 10 discovery flow) */}
        <FundDiscoveryBanner />

        {/* Greeting + primary CTA */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 14,
            marginBottom: 20,
          }}
        >
          <Box>
            <Box style={{ fontSize: 22, fontWeight: 600, color: tokens.textPrimary }}>
              Welcome back, Trinity team
            </Box>
            <Box style={{ fontSize: 13, color: tokens.textSecondary, marginTop: 3 }}>
              You have{' '}
              <span style={{ color: tokens.accentTeal, fontWeight: 600 }}>
                {needsReview.length} job{needsReview.length === 1 ? '' : 's'}
              </span>{' '}
              awaiting review across {fundCount} fund{fundCount === 1 ? '' : 's'}. The AI has done the
              first pass — your sign-off is what&apos;s left.
            </Box>
          </Box>
          <button
            onClick={onNewAudit}
            style={{
              fontFamily: 'inherit',
              background: tokens.primaryGreen,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <IconPlus size={15} />
            New audit job
          </button>
        </Box>

        {/* KPI cards */}
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12,
            marginBottom: 22,
          }}
        >
          <Kpi label="Funds" value={fundCount} />
          <Kpi label="Needs review" value={needsReview.length} color={tokens.primaryGreen} />
          <Kpi label="Processing" value={processing} color={tokens.blue} />
          <Kpi label="Completed" value={completed} />
        </Box>

        {/* Needs-your-attention queue */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Box
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: tokens.textPrimary,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <IconBell size={16} color={tokens.accent} />
            Needs your attention
          </Box>
          {needsReview.length > attention.length && (
            <Box style={{ fontSize: 12, color: tokens.textTertiary }}>
              {needsReview.length} total
            </Box>
          )}
        </Box>

        {attention.length === 0 ? (
          <Box
            style={{
              border: `1px solid ${tokens.hairline}`,
              borderRadius: 11,
              padding: '22px 14px',
              textAlign: 'center',
              color: tokens.textTertiary,
              fontSize: 13,
            }}
          >
            Nothing waiting on you. Start a new audit to get going.
          </Box>
        ) : (
          <Box style={{ border: `1px solid ${tokens.hairline}`, borderRadius: 11, overflow: 'hidden' }}>
            {attention.map((job, i) => (
              <button
                key={job.job_id}
                onClick={() => onSelectJob(job.job_id)}
                className="hover-row"
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '11px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : `1px solid ${tokens.hairline}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: statusDotColor[job.status],
                      flexShrink: 0,
                    }}
                  />
                  <Box style={{ minWidth: 0 }}>
                    <Box
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        rowGap: 3,
                        columnGap: 7,
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: tokens.textPrimary,
                      }}
                    >
                      <span>{job.fund_name}</span>
                      {getModelLabel(models, job.model) && (
                        <span style={modelTagStyle}>{getModelLabel(models, job.model)}</span>
                      )}
                    </Box>
                    <Box style={{ fontSize: 11, color: tokens.textTertiary }}>
                      {job.abn ? `ABN ${job.abn}` : 'No ABN'}
                      {job.message ? ` · ${job.message}` : ''}
                    </Box>
                  </Box>
                </Box>
                <span style={pillStyle(job.status)}>{statusMeta[job.status].label}</span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: tokens.accentTeal,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  Resume <IconChevronRight size={13} />
                </span>
              </button>
            ))}
          </Box>
        )}

        {/* Quiet how-it-works strip for first-timers */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 22,
            padding: '14px 16px',
            background: tokens.strip,
            borderRadius: 11,
          }}
        >
          <Step n={1} label="Select a fund" />
          <IconArrowRight size={14} color={tokens.textTertiary} />
          <Step n={2} label="AI classifies & reconciles" />
          <IconArrowRight size={14} color={tokens.textTertiary} />
          <Step n={3} label="Review & sign off" />
        </Box>
      </Box>
    </Pane>
  )
}
