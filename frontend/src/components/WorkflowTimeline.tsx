import { Fragment, type CSSProperties } from 'react'
import {
  IconAlertTriangle,
  IconCheck,
  IconRobot,
  IconRosette,
  IconUserCheck,
} from '@tabler/icons-react'
import type { JobStatus } from '../api/types'
import { AI_STAGES, timelineNodes, type NodeState } from '../lib/status'
import { tokens } from '../theme'

// 4-stage workflow strip (spec §4.1). Custom flex component — Mantine's
// Timeline is vertical and Stepper styles differ.
const STAGES = [
  { title: 'Classify', owner: 'AI processor', Icon: IconRobot },
  { title: 'Your sign-off', owner: 'you', Icon: IconUserCheck },
  { title: 'Reconcile', owner: 'AI reviewer', Icon: IconRobot },
  { title: 'Final sign-off', owner: 'you', Icon: IconRosette },
] as const

const GREEN = tokens.primaryGreen
const TINT = tokens.primaryTint
const NEUTRAL = tokens.neutralFill
const RED = '#E03131'

function nodeStyle(state: NodeState): CSSProperties {
  const base: CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxSizing: 'border-box',
  }
  switch (state) {
    case 'done':
      return { ...base, background: GREEN, color: '#fff' }
    case 'active':
      return { ...base, background: TINT, border: `2px solid ${GREEN}`, color: GREEN }
    case 'failed':
      return { ...base, background: RED, color: '#fff' }
    case 'upcoming':
    default:
      return { ...base, background: NEUTRAL, color: tokens.textTertiary }
  }
}

function titleColor(state: NodeState): string {
  if (state === 'active') return GREEN
  if (state === 'failed') return RED
  if (state === 'done') return tokens.textPrimary
  return tokens.textTertiary
}

export interface WorkflowTimelineProps {
  status: JobStatus
  progressPercent?: number
}

export function WorkflowTimeline({ status, progressPercent }: WorkflowTimelineProps) {
  const states = timelineNodes(status)

  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}
      role="list"
      aria-label="Workflow progress"
    >
      {STAGES.map((stage, i) => {
        const state = states[i]
        const isAi = AI_STAGES.includes(i)
        const pulsing = state === 'active' && isAi
        const NodeIcon =
          state === 'done' ? IconCheck : state === 'failed' ? IconAlertTriangle : stage.Icon

        const sub =
          state === 'active'
            ? `in progress · ${stage.owner}`
            : state === 'failed'
              ? 'failed'
              : stage.owner

        return (
          <Fragment key={stage.title}>
            <div
              role="listitem"
              aria-current={state === 'active' ? 'step' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                width: 110,
                opacity: state === 'upcoming' ? 0.5 : 1,
              }}
            >
              <div className={pulsing ? 'wf-pulse' : undefined} style={nodeStyle(state)}>
                <NodeIcon size={19} stroke={2.2} />
              </div>
              <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: titleColor(state) }}>
                  {stage.title}
                </div>
                <div style={{ fontSize: 11, color: tokens.textTertiary }}>
                  {pulsing && progressPercent != null ? `${progressPercent}%` : sub}
                </div>
              </div>
            </div>

            {i < STAGES.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  marginTop: 17,
                  borderRadius: 1,
                  background: state === 'done' ? GREEN : tokens.hairline,
                }}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
