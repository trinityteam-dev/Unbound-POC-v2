import { ActionIcon, Group, Text, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconCheck, IconMoon, IconSun } from '@tabler/icons-react'
import { tokens } from '../theme'

// App top bar (spec §2): brand · theme toggle · avatar. 36px, full-bleed.
export function AppHeader() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const dark = colorScheme !== 'light'

  return (
    <Group h={36} px={14} gap={0} justify="space-between" wrap="nowrap">
      <Group gap={7} wrap="nowrap">
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            background: tokens.primaryGreen,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <IconCheck size={12} stroke={3} />
        </div>
        <Text fw={700} fz={13} c={tokens.textPrimary}>
          BeFree
        </Text>
      </Group>

      <Group gap={6} wrap="nowrap">
        <Tooltip label={dark ? 'Light theme' : 'Dark theme'} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={toggleColorScheme}
            aria-label="Toggle theme"
          >
            {dark ? <IconSun size={15} color={tokens.textSecondary} /> : <IconMoon size={15} color={tokens.textSecondary} />}
          </ActionIcon>
        </Tooltip>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: tokens.segActive,
            color: tokens.textSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          TT
        </div>
      </Group>
    </Group>
  )
}
