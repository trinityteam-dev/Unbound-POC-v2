import { useEffect, useState } from 'react'
import { ActionIcon, Box, Button, Modal, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconCheck,
  IconFolderPlus,
  IconPlus,
  IconX,
} from '@tabler/icons-react'
import {
  useBootstrapFunds,
  useDiscoverFunds,
  useRegisterFund,
} from '../api/hooks'
import type { DiscoveredFolder, FundConfig } from '../api/types'
import { tokens } from '../theme'

// Story 10 port from the legacy Flask template: when unregistered fund
// folders appear under data/, show a banner on Home with a "Set up now"
// flow — AI-scan each folder into a proposed config, let the user edit it,
// and register it as a fund.

// TSB fields are held as strings while editing (free typing) and parsed on
// register, matching the legacy form behavior.
interface EditableAccount {
  name: string
  number: string
  bsb: string
}
interface EditableMember {
  name: string
  tfn: string
  prior: string
  current: string
}
interface EditableProposal {
  folderName: string
  warning: string | null
  id: string
  name: string
  abn: string
  folderPath: string
  accounts: EditableAccount[]
  members: EditableMember[]
  keywordComplements: FundConfig['keyword_complements']
  registered: boolean
}

function toFundConfig(p: EditableProposal): FundConfig {
  return {
    id: p.id,
    name: p.name,
    abn: p.abn,
    folder_path: p.folderPath,
    // Drop blank rows, as the legacy form did.
    bank_accounts: p.accounts.filter((a) => a.name || a.number),
    members: p.members
      .filter((m) => m.name)
      .map((m) => ({
        name: m.name,
        tfn: m.tfn,
        prior_year_tsb: parseFloat(m.prior) || 0,
        current_year_tsb: parseFloat(m.current) || 0,
      })),
    keyword_complements: p.keywordComplements,
  }
}

function ColLabel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        fontSize: 10,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: tokens.textTertiary,
        fontWeight: 600,
      }}
    >
      {children}
    </Box>
  )
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'inherit',
        fontSize: 11.5,
        color: tokens.textTertiary,
        background: 'transparent',
        border: `1px dashed ${tokens.border2}`,
        borderRadius: 7,
        padding: '4px 10px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
      }}
    >
      <IconPlus size={11} /> {label}
    </button>
  )
}

const miniInput = {
  input: { fontSize: 12.5, minHeight: 30, height: 30 },
} as const

function ProposalCard({
  proposal,
  registering,
  onChange,
  onRegister,
}: {
  proposal: EditableProposal
  registering: boolean
  onChange: (next: EditableProposal) => void
  onRegister: () => void
}) {
  const p = proposal

  if (p.registered) {
    return (
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          border: `1px solid ${tokens.hairline}`,
          borderRadius: 11,
          background: tokens.primaryTint,
        }}
      >
        <IconCheck size={16} color={tokens.accentTeal} />
        <Box style={{ fontSize: 13, color: tokens.textPrimary, fontWeight: 500 }}>
          {p.name || p.folderName}
        </Box>
        <Box style={{ fontSize: 12, color: tokens.textTertiary }}>registered</Box>
      </Box>
    )
  }

  const setAccount = (i: number, patch: Partial<EditableAccount>) =>
    onChange({
      ...p,
      accounts: p.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    })
  const setMember = (i: number, patch: Partial<EditableMember>) =>
    onChange({
      ...p,
      members: p.members.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    })

  return (
    <Box
      style={{
        border: `1px solid ${tokens.hairline}`,
        borderRadius: 11,
        padding: '14px 14px 12px',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Box style={{ fontSize: 14, fontWeight: 600, color: tokens.textPrimary }}>
          {p.folderName}
        </Box>
        <code
          style={{
            fontSize: 10.5,
            background: tokens.primaryTint,
            color: tokens.accentTeal,
            padding: '2px 7px',
            borderRadius: 5,
          }}
        >
          {p.id}
        </code>
        <Button
          size="compact-xs"
          color="brand"
          loading={registering}
          onClick={onRegister}
          style={{ marginLeft: 'auto' }}
        >
          Register
        </Button>
      </Box>

      {p.warning && (
        <Box
          style={{
            fontSize: 12,
            color: tokens.accent,
            background: tokens.amberTint,
            borderRadius: 7,
            padding: '5px 9px',
            marginBottom: 10,
          }}
        >
          ⚠ {p.warning}
        </Box>
      )}

      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <TextInput
          label="Fund name"
          size="xs"
          styles={miniInput}
          value={p.name}
          onChange={(e) => onChange({ ...p, name: e.currentTarget.value })}
        />
        <TextInput
          label="ABN"
          size="xs"
          styles={miniInput}
          value={p.abn}
          onChange={(e) => onChange({ ...p, abn: e.currentTarget.value })}
        />
      </Box>

      <ColLabel>Bank accounts</ColLabel>
      <Box style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        {p.accounts.map((a, i) => (
          <Box
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 1.2fr auto',
              gap: 4,
              alignItems: 'center',
            }}
          >
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="Account name"
              value={a.name}
              onChange={(e) => setAccount(i, { name: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="Account #"
              value={a.number}
              onChange={(e) => setAccount(i, { number: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="BSB"
              value={a.bsb}
              onChange={(e) => setAccount(i, { bsb: e.currentTarget.value })}
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Remove account"
              onClick={() =>
                onChange({ ...p, accounts: p.accounts.filter((_, j) => j !== i) })
              }
            >
              <IconX size={13} />
            </ActionIcon>
          </Box>
        ))}
      </Box>
      <AddRowButton
        label="Add account"
        onClick={() =>
          onChange({ ...p, accounts: [...p.accounts, { name: '', number: '', bsb: '' }] })
        }
      />

      <Box style={{ marginTop: 12 }}>
        <ColLabel>Members</ColLabel>
      </Box>
      <Box style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        {p.members.map((m, i) => (
          <Box
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.6fr 1fr 1fr auto',
              gap: 4,
              alignItems: 'center',
            }}
          >
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="Member name"
              value={m.name}
              onChange={(e) => setMember(i, { name: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="TFN"
              value={m.tfn}
              onChange={(e) => setMember(i, { tfn: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="Prior TSB"
              value={m.prior}
              onChange={(e) => setMember(i, { prior: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              styles={miniInput}
              placeholder="Current TSB"
              value={m.current}
              onChange={(e) => setMember(i, { current: e.currentTarget.value })}
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Remove member"
              onClick={() =>
                onChange({ ...p, members: p.members.filter((_, j) => j !== i) })
              }
            >
              <IconX size={13} />
            </ActionIcon>
          </Box>
        ))}
      </Box>
      <AddRowButton
        label="Add member"
        onClick={() =>
          onChange({
            ...p,
            members: [...p.members, { name: '', tfn: '', prior: '', current: '' }],
          })
        }
      />
    </Box>
  )
}

function FundSetupModal({
  opened,
  onClose,
  folders,
}: {
  opened: boolean
  onClose: () => void
  folders: DiscoveredFolder[]
}) {
  const bootstrap = useBootstrapFunds()
  const register = useRegisterFund()
  const [proposals, setProposals] = useState<EditableProposal[] | null>(null)
  const [registeringId, setRegisteringId] = useState<string | null>(null)

  // If the discovered set changed since the last scan (folder added/removed
  // while the modal was closed), stale proposals would mislead — start over.
  useEffect(() => {
    if (!opened || !proposals) return
    const proposed = new Set(proposals.map((p) => p.folderPath))
    if (folders.some((f) => !proposed.has(f.folder_path))) setProposals(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  function scan() {
    const targets = folders
    bootstrap.mutate(
      targets.map((f) => f.folder_path),
      {
        onSuccess: (results) => {
          setProposals(
            results.map((r, i) => ({
              folderName:
                targets[i]?.folder_name ??
                r.proposed.folder_path.split('/').pop() ??
                r.proposed.id,
              warning: r.warning,
              id: r.proposed.id,
              name: r.proposed.name,
              abn: r.proposed.abn,
              folderPath: r.proposed.folder_path,
              accounts: r.proposed.bank_accounts.map((a) => ({ ...a })),
              members: r.proposed.members.map((m) => ({
                name: m.name,
                tfn: m.tfn,
                prior: String(m.prior_year_tsb || 0),
                current: String(m.current_year_tsb || 0),
              })),
              keywordComplements: r.proposed.keyword_complements,
              registered: false,
            })),
          )
        },
        onError: (err) => {
          notifications.show({
            color: 'red',
            title: 'Scan failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        },
      },
    )
  }

  function registerProposal(p: EditableProposal) {
    setRegisteringId(p.id)
    register.mutate(toFundConfig(p), {
      onSuccess: () => {
        setProposals(
          (prev) =>
            prev?.map((x) => (x.id === p.id ? { ...x, registered: true } : x)) ?? null,
        )
        notifications.show({
          color: 'teal',
          title: 'Fund registered',
          message: `${p.name || p.folderName} is now available for audit jobs.`,
        })
      },
      onError: (err) => {
        notifications.show({
          color: 'red',
          title: 'Could not register fund',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      },
      onSettled: () => setRegisteringId(null),
    })
  }

  let body: React.ReactNode
  if (bootstrap.isPending) {
    body = (
      <Box style={{ textAlign: 'center', padding: '34px 12px', color: tokens.textTertiary }}>
        <Box style={{ fontSize: 24, marginBottom: 8 }}>🔍</Box>
        <Box style={{ fontWeight: 600, color: tokens.textPrimary, marginBottom: 3 }}>
          Reading documents…
        </Box>
        <Box style={{ fontSize: 12.5 }}>
          Extracting fund details via AI — this may take 15–30s per folder.
        </Box>
      </Box>
    )
  } else if (proposals) {
    body = (
      <Box style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            registering={registeringId === p.id}
            onChange={(next) =>
              setProposals((prev) => prev?.map((x) => (x.id === p.id ? next : x)) ?? null)
            }
            onRegister={() => registerProposal(p)}
          />
        ))}
      </Box>
    )
  } else {
    body = (
      <>
        <Box style={{ border: `1px solid ${tokens.hairline}`, borderRadius: 11, overflow: 'hidden' }}>
          {folders.map((f, i) => (
            <Box
              key={f.folder_path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 13px',
                borderTop: i === 0 ? 'none' : `1px solid ${tokens.hairline}`,
              }}
            >
              <IconFolderPlus size={15} color={tokens.accentTeal} />
              <Box style={{ fontSize: 13, fontWeight: 500, color: tokens.textPrimary }}>
                {f.folder_name}
              </Box>
              <Box style={{ fontSize: 11.5, color: tokens.textTertiary }}>
                {f.pdf_count} PDF{f.pdf_count === 1 ? '' : 's'}
              </Box>
            </Box>
          ))}
        </Box>
        <Box style={{ textAlign: 'center', marginTop: 16 }}>
          <Button color="brand" onClick={scan}>
            Scan &amp; propose config
          </Button>
          <Box style={{ fontSize: 12, color: tokens.textTertiary, marginTop: 7 }}>
            The AI will read each folder&rsquo;s documents and extract fund details.
          </Box>
        </Box>
      </>
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Set up new funds" centered size="lg">
      {body}
    </Modal>
  )
}

/**
 * Home-page banner surfacing unregistered fund folders dropped into data/.
 * Self-contained: polls discovery itself and owns the setup modal.
 */
export function FundDiscoveryBanner() {
  const discover = useDiscoverFunds()
  const [dismissed, setDismissed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const folders = discover.data ?? []
  if (folders.length === 0 || dismissed) return null

  return (
    <>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '11px 14px',
          background: tokens.amberTint,
          border: `1px solid ${tokens.accentBorder}`,
          borderRadius: 11,
          marginBottom: 18,
        }}
      >
        <IconFolderPlus size={18} color={tokens.accent} style={{ flexShrink: 0 }} />
        <Box style={{ flex: 1, fontSize: 13, color: tokens.textPrimary }}>
          <b>
            {folders.length} new fund folder{folders.length === 1 ? '' : 's'}
          </b>{' '}
          detected in <code style={{ fontSize: 12 }}>data/</code> — set up to include{' '}
          {folders.length === 1 ? 'it' : 'them'} in processing.
        </Box>
        <Button size="compact-sm" color="brand" onClick={() => setModalOpen(true)}>
          Set up now
        </Button>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <IconX size={15} />
        </ActionIcon>
      </Box>
      <FundSetupModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        folders={folders}
      />
    </>
  )
}
