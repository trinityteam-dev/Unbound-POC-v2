import type { JobFile, ReviewFile } from '../../api/types'

/** Map a (possibly-edited) classified file to the processor-review payload shape. */
export function toReviewFile(f: JobFile): ReviewFile {
  return {
    original_name: f.original_name,
    classified_name: f.classified_name,
    category: f.category,
    account_number: f.account_number,
    amount: f.amount,
    date: f.date,
    notes: 'notes' in f && f.notes ? f.notes : '',
  }
}

// NOTE: the engine stores playbook keywords as comma-separated STRINGS per
// category (e.g. "ATO, Trustee, Declaration"), not arrays. We tolerate both
// on the way in and save back as normalized comma-strings.

/** Playbook category→keywords → category→display string (for editing). */
export function playbookToRows(
  playbook: Record<string, string | string[]>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(playbook).map(([cat, val]) => [
      cat,
      Array.isArray(val) ? val.join(', ') : (val ?? ''),
    ]),
  )
}

/** Editing strings → category→normalized comma-string (for saving). */
export function rowsToPlaybook(
  rows: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(rows).map(([cat, str]) => [
      cat,
      str
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', '),
    ]),
  )
}
