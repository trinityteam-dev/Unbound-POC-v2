import { Burger, Group, Text } from '@mantine/core'
import {
  IconBriefcase,
  IconChartBar,
  IconCheck,
  IconFileStack,
  IconRobot,
  IconClipboardList,
  IconUsers,
} from '@tabler/icons-react'
import { tokens } from '../theme'

// Top app-level nav — mirrors the existing UI's header tabs
// (templates/index.html:1595). Step 1 / Step 2 are functional; the rest are
// placeholders shown disabled, exactly as today.
export interface AppHeaderProps {
  activeStep: 1 | 2
  step2Enabled: boolean
  onStepChange: (step: 1 | 2) => void
  navOpened?: boolean
  onBurgerClick?: () => void
}

function Tab({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={!disabled && !active ? 'app-tab' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 64,
        padding: '0 16px',
        border: 'none',
        background: active ? 'rgba(13,148,136,0.09)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        color: active ? '#0F766E' : tokens.textTertiary,
        opacity: disabled ? 0.4 : 1,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        borderRadius: active ? '8px 8px 0 0' : 0,
        borderBottom: `2px solid ${active ? tokens.accent : 'transparent'}`,
        fontFamily: 'inherit',
        transition: 'background 120ms ease',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function AppHeader({
  activeStep,
  step2Enabled,
  onStepChange,
  navOpened,
  onBurgerClick,
}: AppHeaderProps) {
  return (
    <Group h="100%" px="md" gap={0} wrap="nowrap" style={{ overflow: 'hidden' }}>
      <Burger
        opened={navOpened}
        onClick={onBurgerClick}
        hiddenFrom="sm"
        size="sm"
        mr="sm"
        aria-label="Toggle navigation"
      />
      <Group gap={8} pr="lg" wrap="nowrap">
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: tokens.primaryGreen,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <IconCheck size={18} stroke={3} />
        </div>
        <Text fw={700} fz={17} c={tokens.textPrimary}>
          ABC Accounting Inc.
        </Text>
      </Group>

      <Group gap={0} wrap="nowrap">
        <Tab
          icon={<IconClipboardList size={17} />}
          label="Step 1 — Doc Intel"
          active={activeStep === 1}
          onClick={() => onStepChange(1)}
        />
        <Tab
          icon={<IconRobot size={17} />}
          label="Step 2 — Orchestration & Data Intel"
          active={activeStep === 2}
          disabled={!step2Enabled}
          onClick={() => onStepChange(2)}
        />
        <Tab icon={<IconUsers size={17} />} label="Clients" disabled />
        <Tab icon={<IconBriefcase size={17} />} label="Jobs" disabled />
        <Tab icon={<IconFileStack size={17} />} label="Order Docs" disabled />
        <Tab icon={<IconChartBar size={17} />} label="Reports" disabled />
      </Group>
    </Group>
  )
}
