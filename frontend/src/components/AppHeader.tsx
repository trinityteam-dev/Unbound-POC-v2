import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconChecks, IconMoon, IconSparkles, IconSun } from '@tabler/icons-react'

// App top bar (spec §2), SuperRecords-aligned: navy chrome, BeFree large + bold
// on the left, the product title centered with the "A" and "i" letters enlarged
// in bright green so they read as A·I — signalling AI as the lever of the app.
const NAVY = '#151b2d'
const GREEN = '#00af5a'
const AI_GREEN = '#22e07f' // brighter green for legibility on navy

// One highlighted letter ("A" or "i"), sized up and weighted to stand out.
function Ai({ children }: { children: string }) {
  return (
    <span style={{ fontSize: 33, fontWeight: 800, color: AI_GREEN, lineHeight: 0 }}>
      {children}
    </span>
  )
}

export function AppHeader() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        columnGap: 16,
        height: 64,
        padding: '0 24px',
        background: NAVY,
      }}
    >
      {/* Left — company brand, large and bold */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, justifySelf: 'start' }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: GREEN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            flexShrink: 0,
          }}
        >
          <IconChecks size={23} stroke={2.2} />
        </div>
        <span style={{ fontSize: 27, fontWeight: 800, color: '#fff', letterSpacing: 0.2 }}>
          BeFree
        </span>
      </div>

      {/* Center — product title, AI letters standing out */}
      <div
        style={{
          justifySelf: 'center',
          display: 'inline-flex',
          alignItems: 'baseline',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          fontSize: 21,
          fontWeight: 500,
          color: '#eef1f7',
          letterSpacing: 0.3,
        }}
      >
        SMSF&nbsp;<Ai>A</Ai>ccount<Ai>i</Ai>ng&nbsp;
        <span style={{ color: '#5a6c83', fontWeight: 400 }}>&amp;</span>
        &nbsp;<Ai>A</Ai>ud<Ai>i</Ai>t
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
            color: AI_GREEN,
            border: `1px solid rgba(34, 224, 127, 0.4)`,
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
              <IconSun size={17} color="rgba(255,255,255,0.7)" />
            ) : (
              <IconMoon size={17} color="rgba(255,255,255,0.7)" />
            )}
          </ActionIcon>
        </Tooltip>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: '#2a3450',
            color: '#cfd6e6',
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
