import type { ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import { render } from '@testing-library/react'

/** Render UI wrapped in a MantineProvider (most components need the theme). */
export function renderUI(ui: ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>)
}
