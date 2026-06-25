import { useEffect, useState } from 'react'
import { Box, Stack } from '@mantine/core'
import { useFunds } from '../../api/hooks'
import type { JobDetail, JobFile } from '../../api/types'
import { DocumentsCard } from './DocumentsCard'
import { OverrideModal, type OverrideDraft } from './OverrideModal'
import { PlaybookCard } from './PlaybookCard'
import { ProcessorSignoffCard } from './ProcessorSignoffCard'
import { UnprocessedCard } from './UnprocessedCard'

// Step 1 — mirrors the existing IA: docs + sign-off (left), Playbook (right).
// Document edits are batched client-side until the processor signs off.
export function Step1({ job }: { job: JobDetail }) {
  const editable = job.status === 'pending_processor_review'
  const funds = useFunds()

  const [files, setFiles] = useState<JobFile[]>(job.files)
  const [overrideIdx, setOverrideIdx] = useState<number | null>(null)

  // Reseed the local copy when the job changes (id or status transition).
  useEffect(() => {
    setFiles(job.files)
    setOverrideIdx(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.job_id, job.status])

  const fund = funds.data?.find((f) => f.id === job.fund_id)
  const playbookCats = Object.keys(fund?.keywords?.[job.job_type] ?? {})
  // Fall back to categories present in the files if the playbook is empty.
  const categories =
    playbookCats.length > 0
      ? playbookCats
      : Array.from(new Set(files.map((f) => f.category).filter(Boolean)))

  function applyOverride(draft: OverrideDraft) {
    if (overrideIdx === null) return
    setFiles((prev) =>
      prev.map((f, i) =>
        i === overrideIdx
          ? {
              ...f,
              category: draft.category,
              account_number: draft.account_number || null,
              amount: draft.amount || null,
              date: draft.date || null,
              notes: draft.notes,
            }
          : f,
      ),
    )
    setOverrideIdx(null)
  }

  return (
    <>
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <Stack gap="lg">
          <DocumentsCard
            jobId={job.job_id}
            files={files}
            editable={editable}
            onOverride={setOverrideIdx}
          />
          <UnprocessedCard files={job.unprocessed_files} />
          <ProcessorSignoffCard jobId={job.job_id} files={files} enabled={editable} />
        </Stack>

        <PlaybookCard job={job} funds={funds.data} />
      </Box>

      <OverrideModal
        file={overrideIdx !== null ? files[overrideIdx] : null}
        categories={categories}
        onClose={() => setOverrideIdx(null)}
        onApply={applyOverride}
      />
    </>
  )
}
