import { useEffect, useState } from 'react'
import { Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core'
import type { JobFile } from '../../api/types'

export interface OverrideDraft {
  category: string
  account_number: string
  amount: string
  date: string
  notes: string
}

export interface OverrideModalProps {
  file: JobFile | null
  categories: string[]
  onClose: () => void
  onApply: (draft: OverrideDraft) => void
}

const EMPTY: OverrideDraft = {
  category: '',
  account_number: '',
  amount: '',
  date: '',
  notes: '',
}

export function OverrideModal({ file, categories, onClose, onApply }: OverrideModalProps) {
  const [draft, setDraft] = useState<OverrideDraft>(EMPTY)

  useEffect(() => {
    if (file) {
      setDraft({
        category: file.category ?? '',
        account_number: file.account_number ?? '',
        amount: file.amount ?? '',
        date: file.date ?? '',
        notes: 'notes' in file ? (file.notes ?? '') : '',
      })
    }
  }, [file])

  // Ensure the current category is selectable even if not in the playbook list.
  const options = Array.from(new Set([...categories, draft.category].filter(Boolean)))

  return (
    <Modal opened={!!file} onClose={onClose} title="Override classification" centered>
      <Stack gap="sm">
        <Select
          label="Category"
          data={options}
          value={draft.category}
          onChange={(v) => setDraft((d) => ({ ...d, category: v ?? '' }))}
          searchable
        />
        <TextInput
          label="Account number"
          value={draft.account_number}
          onChange={(e) => setDraft((d) => ({ ...d, account_number: e.currentTarget.value }))}
        />
        <Group grow>
          <TextInput
            label="Amount"
            value={draft.amount}
            placeholder="270.41"
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.currentTarget.value }))}
          />
          <TextInput
            label="Date"
            value={draft.date}
            placeholder="30.06.25"
            onChange={(e) => setDraft((d) => ({ ...d, date: e.currentTarget.value }))}
          />
        </Group>
        <Textarea
          label="Notes"
          value={draft.notes}
          autosize
          minRows={2}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.currentTarget.value }))}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="brand" onClick={() => onApply(draft)}>
            Apply
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
