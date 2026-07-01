import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconMoon, IconSparkles, IconSun } from '@tabler/icons-react'

function Ai({ children, color }: { children: string; color: string }) {
  return (
    <span style={{ fontSize: 33, fontWeight: 800, color, lineHeight: 0 }}>
      {children}
    </span>
  )
}

export function AppHeader() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'

  // Header is always light so the logo (blue bird + dark "free" text) reads cleanly.
  // Light mode: pure white. Dark mode: a cool blue-grey that keeps dark text legible
  // while feeling distinct from the white light-mode header.
  const headerBg     = dark ? '#dce4f0' : '#ffffff'
  const headerBorder = dark ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.08)'
  const titleColor   = '#151b2d'                   // navy on both light backgrounds
  const titleDim     = '#8a93a6'
  const aiColor      = '#00875a'                   // readable dark green on light bg
  const chipBorder   = 'rgba(0,135,90,0.4)'
  const avatarBg     = dark ? '#bccadf' : '#e8edf5'
  const avatarText   = '#2a3a5c'
  const toggleColor  = 'rgba(0,0,0,0.45)'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        columnGap: 16,
        height: 64,
        padding: '0 24px',
        background: headerBg,
        borderBottom: `1px solid ${headerBorder}`,
      }}
    >
      {/* Left — logo sits directly on the light header, no container needed */}
      <div style={{ justifySelf: 'start' }}>
        <img
          src="/befree-logo.png"
          alt="BeFree"
          style={{ height: 48, width: 'auto', display: 'block' }}
        />
      </div>

      {/* Center — product title */}
      <div
        style={{
          justifySelf: 'center',
          display: 'inline-flex',
          alignItems: 'baseline',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          fontSize: 21,
          fontWeight: 500,
          color: titleColor,
          letterSpacing: 0.3,
        }}
      >
        SMSF&nbsp;<Ai color={aiColor}>A</Ai>ccount<Ai color={aiColor}>i</Ai>ng&nbsp;
        <span style={{ color: titleDim, fontWeight: 400 }}>&amp;</span>
        &nbsp;<Ai color={aiColor}>A</Ai>ud<Ai color={aiColor}>i</Ai>t
      </div>

      {/* Right — AI cue, theme toggle, avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, justifySelf: 'end' }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            fontWeight: 500,
            color: aiColor,
            border: `1px solid ${chipBorder}`,
            padding: '4px 10px',
            borderRadius: 999,
          }}
        >
          <IconSparkles size={13} />
          AI-driven
        </span>
        <Tooltip label={dark ? 'Light theme' : 'Dark theme'} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            onClick={toggleColorScheme}
            aria-label="Toggle theme"
          >
            {dark ? (
              <IconSun size={17} color={toggleColor} />
            ) : (
              <IconMoon size={17} color={toggleColor} />
            )}
          </ActionIcon>
        </Tooltip>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: avatarBg,
            color: avatarText,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          TT
        </div>
      </div>
    </div>
  )
}
