import { useEffect, useState } from 'react'
import { Box, Button, Drawer, Group, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconSettings } from '@tabler/icons-react'
import {
  useFunds,
  usePlaybook,
  useSaveFundComplements,
  useSavePlaybook,
} from '../../api/hooks'
import type { JobDetail } from '../../api/types'
import { playbookToRows, rowsToPlaybook } from '../step1/utils'
import { tokens } from '../../theme'

// Fund-level config, reachable in every phase (spec §9). Two layers:
//  • Global playbook (shared taxonomy + keywords) — edit + add categories here.
//  • Per-fund complements — additive keywords just for this fund.
// See docs/PLAYBOOK_REFACTOR_DESIGN.md.
export interface PlaybookDrawerProps {
  job: JobDetail
  opened: boolean
  onClose: () => void
}

const LABEL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
}

export function PlaybookDrawer({ job, opened, onClose }: PlaybookDrawerProps) {
  const playbookQ = usePlaybook()
  const funds = useFunds()
  const fund = funds.data?.find((f) => f.id === job.fund_id)
  const savePlaybook = useSavePlaybook()
  const saveComplements = useSaveFundComplements()
  const jt = job.job_type

  const [globalRows, setGlobalRows] = useState<Record<string, string>>({})
  const [compRows, setCompRows] = useState<Record<string, string>>({})
  const [newCat, setNewCat] = useState('')
  const [newKw, setNewKw] = useState('')

  useEffect(() => {
    setGlobalRows(playbookToRows(playbookQ.data?.[jt] ?? {}))
    setCompRows(playbookToRows(fund?.keyword_complements?.[jt] ?? {}))
    setNewCat('')
    setNewKw('')
  }, [playbookQ.data, fund?.id, jt, opened])

  const categories = Object.keys(globalRows)
  const saving = savePlaybook.isPending || saveComplements.isPending

  function addCategory() {
    const name = newCat.trim()
    if (!name || globalRows[name] != null) return
    setGlobalRows((prev) => ({ ...prev, [name]: newKw }))
    setNewCat('')
    setNewKw('')
  }

  async function handleSave() {
    // Flush a category the user typed into the "Add category" fields but didn't
    // explicitly add — so Save never silently drops it.
    let rows = globalRows
    const pendingName = newCat.trim()
    if (pendingName && rows[pendingName] == null) {
      rows = { ...rows, [pendingName]: newKw }
    }
    const nextPlaybook = { ...(playbookQ.data ?? {}), [jt]: rowsToPlaybook(rows) }
    // Keep only non-empty complement rows so we don't persist blanks.
    const compNorm = rowsToPlaybook(compRows)
    const compTrimmed = Object.fromEntries(Object.entries(compNorm).filter(([, v]) => v))
    const nextComplements = { ...(fund?.keyword_complements ?? {}), [jt]: compTrimmed }

    try {
      await savePlaybook.mutateAsync(nextPlaybook)
      if (fund) {
        await saveComplements.mutateAsync({ id: fund.id, keyword_complements: nextComplements })
      }
      notifications.show({
        color: 'teal',
        title: 'Playbook saved',
        message: 'Classification keywords updated.',
      })
      onClose()
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={440}
      withCloseButton={false}
      padding={0}
      styles={{ content: { background: tokens.surface }, body: { height: '100%' } }}
    >
      <Stack gap={0} h="100%">
        <Group
          px={20}
          py={14}
          justify="space-between"
          wrap="nowrap"
          style={{ borderBottom: `2px solid var(--vi)` }}
        >
          <Group gap={8} wrap="nowrap">
            <IconSettings size={16} color={tokens.violet} />
            <Box>
              <Text fz={14} fw={600} c={tokens.textPrimary}>
                Playbook
              </Text>
              <Text fz={11.5} c={tokens.textTertiary}>
                {fund?.name ?? job.fund_name} · {jt}
              </Text>
            </Box>
          </Group>
          <Button variant="subtle" color="gray" size="compact-sm" onClick={onClose}>
            Close
          </Button>
        </Group>

        <Box className="scroll-accent" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Global playbook — shared across all funds */}
          <Text style={{ ...LABEL, color: tokens.violet }} mb={4}>
            Global playbook
          </Text>
          <Text fz={12} c={tokens.textTertiary} mb="sm">
            Categories and keywords the AI uses to classify documents. Shared by every fund.
          </Text>

          {playbookQ.isLoading ? (
            <Text fz={13} c={tokens.textTertiary}>
              Loading…
            </Text>
          ) : categories.length === 0 ? (
            <Text fz={13} c={tokens.textTertiary}>
              No categories for this playbook yet — add one below.
            </Text>
          ) : (
            <Stack gap="sm">
              {categories.map((cat) => (
                <div key={cat}>
                  <Text fz={12.5} fw={500} c={tokens.textSecondary} mb={4}>
                    {cat}
                  </Text>
                  <TextInput
                    size="xs"
                    value={globalRows[cat]}
                    placeholder="comma, separated, keywords"
                    onChange={(e) =>
                      setGlobalRows((prev) => ({ ...prev, [cat]: e.currentTarget.value }))
                    }
                  />
                </div>
              ))}
            </Stack>
          )}

          {/* Add a new global category */}
          <Box
            mt="md"
            p={12}
            style={{
              border: `1px dashed ${tokens.border2}`,
              borderRadius: 8,
            }}
          >
            <Text fz={11.5} fw={600} c={tokens.textSecondary} mb={6}>
              Add category
            </Text>
            <Stack gap={6}>
              <TextInput
                size="xs"
                placeholder="Category name (e.g. ASIC Company Extract)"
                value={newCat}
                onChange={(e) => setNewCat(e.currentTarget.value)}
              />
              <TextInput
                size="xs"
                placeholder="comma, separated, keywords"
                value={newKw}
                onChange={(e) => setNewKw(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCategory()
                }}
              />
              <Button
                size="compact-sm"
                variant="light"
                color="violet"
                leftSection={<IconPlus size={14} />}
                disabled={!newCat.trim() || globalRows[newCat.trim()] != null}
                onClick={addCategory}
                style={{ alignSelf: 'flex-start' }}
              >
                Add category
              </Button>
            </Stack>
          </Box>

          {/* Per-fund additive complements */}
          {categories.length > 0 && (
            <>
              <Text style={{ ...LABEL, color: tokens.textTertiary }} mt="xl" mb={4}>
                {fund?.name ?? 'This fund'} · extra keywords
              </Text>
              <Text fz={12} c={tokens.textTertiary} mb="sm">
                Optional. These are <b>added</b> to the global keywords for this fund only — never
                replace them.
              </Text>
              <Stack gap="sm">
                {categories.map((cat) => (
                  <div key={cat}>
                    <Text fz={12.5} fw={500} c={tokens.textSecondary} mb={4}>
                      {cat}
                    </Text>
                    <TextInput
                      size="xs"
                      value={compRows[cat] ?? ''}
                      placeholder="fund-specific keywords (optional)"
                      onChange={(e) =>
                        setCompRows((prev) => ({ ...prev, [cat]: e.currentTarget.value }))
                      }
                    />
                  </div>
                ))}
              </Stack>
            </>
          )}
        </Box>

        <Box px={20} py={14} style={{ borderTop: `1px solid ${tokens.hairline}` }}>
          <Button fullWidth color="brand" loading={saving} onClick={handleSave}>
            Save playbook
          </Button>
        </Box>
      </Stack>
    </Drawer>
  )
}
