import { useState } from 'react'
import { Button, Modal, Select, Stack } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCreateJob, useFunds } from '../api/hooks'

// Run-config modal, lifted out of the sidebar so the landing page can open it
// too. App owns the open/close state; both entry points share this one modal.
export function NewAuditModal({
  opened,
  onClose,
  onCreated,
  model,
}: {
  opened: boolean
  onClose: () => void
  onCreated: (jobId: string) => void
  model: string | null
}) {
  const funds = useFunds()
  const createJob = useCreateJob()
  const [fundId, setFundId] = useState<string | null>(null)
  const [jobType, setJobType] = useState<string | null>('Accounting_Audit')

  const fundOptions =
    funds.data
      ?.filter((f) => !!f.id)
      .map((f) => ({ value: f.id, label: f.name ?? f.id })) ?? []

  function handleRun() {
    if (!fundId || createJob.isPending) return
    createJob.mutate(
      {
        fund_id: fundId,
        job_type: jobType ?? 'Accounting_Audit',
        ...(model ? { model } : {}),
      },
      {
        onSuccess: (res) => {
          notifications.show({
            color: 'teal',
            title: 'Audit started',
            message: 'The AI processor is classifying documents.',
          })
          setFundId(null)
          onCreated(res.job_id)
          onClose()
        },
        onError: (err) => {
          notifications.show({
            color: 'red',
            title: 'Could not start audit',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        },
      },
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} title="New audit job" centered>
      <Stack gap="sm">
        <Select
          label="Fund"
          placeholder="Select fund"
          data={fundOptions}
          value={fundId}
          onChange={setFundId}
          searchable
          nothingFoundMessage="No funds"
          disabled={funds.isLoading}
        />
        <Select
          label="Playbook"
          value={jobType}
          onChange={setJobType}
          allowDeselect={false}
          data={[
            { value: 'Accounting_Audit', label: 'Accounting & Audit (Full)' },
            { value: 'Accounting', label: 'Accounting (Limited Ledger)' },
          ]}
        />
        <Button
          fullWidth
          mt="xs"
          color="brand"
          loading={createJob.isPending}
          disabled={!fundId}
          onClick={handleRun}
        >
          Run audit pipeline
        </Button>
      </Stack>
    </Modal>
  )
}
