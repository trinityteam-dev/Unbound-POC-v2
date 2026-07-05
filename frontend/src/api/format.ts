// Display helpers for the engine's loosely-typed string fields (spec §8).

import type { ModelOption } from './types'

/** Parse a string amount ("270.41") to a number, or null when absent/invalid. */
export function parseAmount(a: string | null | undefined): number | null {
  if (a == null || a === '') return null
  const n = Number(a)
  return Number.isFinite(n) ? n : null
}

/** Format a string amount as AUD currency; em-dash when absent. */
export function formatMoney(a: string | null | undefined): string {
  const n = parseAmount(a)
  if (n == null) return '—'
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

/** Parse the engine's short date "dd.mm.yy" → Date, or null. */
export function parseShortDate(d: string | null | undefined): Date | null {
  if (!d) return null
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(d.trim())
  if (!m) return null
  const [, dd, mm, yy] = m
  const year = 2000 + Number(yy)
  const date = new Date(year, Number(mm) - 1, Number(dd))
  return Number.isNaN(date.getTime()) ? null : date
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Display a short date as "30 Jun 2025"; em-dash when absent/unparseable.
 * Uses a fixed month table (not Intl) so output is stable across ICU builds.
 */
export function formatShortDate(d: string | null | undefined): string {
  const date = parseShortDate(d)
  if (!date) return d ? d : '—'
  const dd = String(date.getDate()).padStart(2, '0')
  return `${dd} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** Parse the engine's space-separated created_at "2026-06-19 11:08:31" → Date. */
export function parseCreatedAt(s: string | null | undefined): Date | null {
  if (!s) return null
  const date = new Date(s.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Compact relative time from created_at → "2h ago", "3d ago", etc. */
export function formatRelative(s: string | null | undefined): string {
  const d = parseCreatedAt(s)
  if (!d) return ''
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  return `${mo}mo ago`
}

/** Compact relative time for tight UI slots: "now", "5m", "2h", "3d", "4mo". */
export function formatRelativeShort(s: string | null | undefined): string {
  const rel = formatRelative(s)
  if (!rel) return ''
  if (rel === 'just now') return 'now'
  return rel.replace(' ago', '')
}

/** Format a numeric AUD amount; em-dash when null/undefined. */
export function formatAud(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

/** Compact token count: 248000 → "248k tok". */
export function formatTokens(n: number | null | undefined): string {
  if (n == null) return ''
  return n >= 1000 ? `${Math.round(n / 1000)}k tok` : `${n} tok`
}

/** Job total cost as "$0.080" (3 decimals); null when unavailable. */
export function formatCost(
  usage: { job_total?: { cost_usd?: number } } | null | undefined,
): string | null {
  const cost = usage?.job_total?.cost_usd
  if (cost == null) return null
  return `$${cost.toFixed(3)}`
}

/**
 * Friendly label for a job's recorded model id ("x-ai/grok-4.20" → "Grok
 * 4.20"). Falls back to the raw id if it's no longer in models_config.json,
 * or null if the job predates model selection (no id recorded at all).
 */
export function getModelLabel(
  models: ModelOption[] | undefined,
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null
  return models?.find((m) => m.model === modelId)?.label ?? modelId
}
