import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Box } from '@mantine/core'
import { useJobDetails, useJobs } from './api/hooks'
import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'

const MIN_SIDEBAR = 220
const MAX_SIDEBAR = 640
const DEFAULT_SIDEBAR = 268

// Draggable gutter (also the visual seam) between the sidebar and details pane.
// Growing the sidebar shrinks the pane and vice-versa.
function ResizeHandle({
  width,
  onResize,
}: {
  width: number
  onResize: (next: number) => void
}) {
  const [active, setActive] = useState(false)
  // Keep the latest width without re-binding the drag handler.
  const widthRef = useRef(width)
  widthRef.current = width

  function onPointerDown(e: ReactPointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    setActive(true)
    function onMove(ev: PointerEvent) {
      const next = startW + (ev.clientX - startX)
      const max = Math.min(MAX_SIDEBAR, window.innerWidth - 360)
      onResize(Math.max(MIN_SIDEBAR, Math.min(max, next)))
    }
    function onUp() {
      setActive(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(DEFAULT_SIDEBAR)}
      style={{
        flexShrink: 0,
        width: 8,
        cursor: 'col-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
        touchAction: 'none',
      }}
    >
      <span
        style={{
          width: 2,
          height: 36,
          borderRadius: 2,
          background: active ? 'var(--tl)' : 'var(--ab)',
          transition: 'background 120ms ease',
        }}
      />
    </Box>
  )
}

// One stable frame (spec §2): top bar → [sidebar panel · details pane] with a
// draggable gutter showing the canvas between the two rounded panels. Phase is
// driven by the selected job's status — there is no Step 1/Step 2 toggle.
export default function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR)

  const jobs = useJobs()
  const details = useJobDetails(selectedJobId)
  const job = details.data

  // Auto-select the first job once the list loads (demo convenience).
  useEffect(() => {
    if (!selectedJobId && jobs.data && jobs.data.length > 0) {
      setSelectedJobId(jobs.data[0].job_id)
    }
  }, [jobs.data, selectedJobId])

  return (
    <Box
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <Box style={{ flexShrink: 0 }}>
        <AppHeader />
      </Box>

      {/* Two panels separated by a draggable gutter (spec §2). */}
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          padding: '0 6px 6px',
        }}
      >
        <Sidebar
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
          width={sidebarWidth}
        />
        <ResizeHandle width={sidebarWidth} onResize={setSidebarWidth} />
        <Workspace
          job={job}
          isLoading={!!selectedJobId && details.isLoading}
          isError={details.isError}
          onRetry={() => details.refetch()}
        />
      </Box>
    </Box>
  )
}
