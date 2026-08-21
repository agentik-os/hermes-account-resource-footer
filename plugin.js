import {
  Codicon,
  host,
  Popover,
  PopoverContent,
  PopoverTrigger,
  STATUSBAR_AREAS,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'account-resource-footer'
const REFRESH_RESOURCES_MS = 15_000
const REFRESH_ACCOUNT_MS = 60_000
const PROVIDERS = ['openai-codex', 'anthropic']

const pct = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : null)
const gib = value => (Number.isFinite(Number(value)) ? `${(Number(value) / 1024 ** 3).toFixed(1)} GB` : '—')
const providerLabel = value => value === 'openai-codex' ? 'OpenAI' : value === 'anthropic' ? 'Claude' : value || 'Account'
const usageTone = value => {
  const amount = pct(value)
  if (amount === null) return 'var(--ui-text-tertiary)'
  if (amount > 95) return 'var(--dt-destructive)'
  if (amount >= 80) return 'var(--ui-warning, #f59e0b)'
  return 'var(--ui-success)'
}

function quietButton(children, onClick, disabled = false) {
  return jsx('button', {
    type: 'button',
    disabled,
    onClick,
    style: {
      minHeight: 28,
      padding: '4px 9px',
      border: '1px solid var(--ui-stroke-secondary)',
      borderRadius: 9,
      background: 'transparent',
      color: 'var(--ui-text-primary)',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.55 : 1,
      fontSize: '0.72rem'
    },
    children
  })
}

function Meter({ label, value }) {
  const amount = pct(value)
  return jsxs('div', {
    style: { display: 'grid', gridTemplateColumns: '56px 1fr 36px', gap: 8, alignItems: 'center' },
    children: [
      jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: label }),
      jsx('span', {
        style: { height: 5, overflow: 'hidden', borderRadius: 999, background: 'var(--ui-stroke-tertiary)' },
        children: jsx('span', {
          style: {
            display: 'block', height: '100%', width: `${amount ?? 0}%`, borderRadius: 999,
            background: usageTone(amount)
          }
        })
      }),
      jsx('span', { style: { textAlign: 'right', color: 'var(--ui-text-secondary)' }, children: amount === null ? '—' : `${amount}%` })
    ]
  })
}

function AccountRows({ accountsByProvider, onUse }) {
  const rows = PROVIDERS.flatMap(provider => (accountsByProvider[provider] || []).map(account => ({ ...account, provider })))
  if (!rows.length) return jsx('div', { style: { color: 'var(--ui-text-tertiary)' }, children: 'No pooled Claude/OpenAI account on this gateway.' })
  return jsx('div', {
    style: { display: 'grid', gap: 5 },
    children: rows.map(account => jsxs('button', {
      type: 'button',
      onClick: () => onUse(account.provider, account.id),
      style: {
        display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8,
        padding: '7px 8px', borderRadius: 9,
        border: account.preferred ? '1px solid var(--ui-accent)' : '1px solid var(--ui-stroke-secondary)',
        background: account.preferred ? 'color-mix(in srgb, var(--ui-accent) 10%, transparent)' : 'transparent',
        color: 'var(--ui-text-primary)', textAlign: 'left', cursor: 'pointer'
      },
      children: [
        jsxs('span', { children: [
          jsx('strong', { style: { display: 'block', fontSize: '0.75rem' }, children: account.label || account.id }),
          jsx('small', { style: { color: 'var(--ui-text-tertiary)' }, children: `${providerLabel(account.provider)} · ${account.status || 'ok'}` })
        ] }),
        jsx('span', { style: { fontSize: '0.68rem', color: account.preferred ? 'var(--ui-accent)' : 'var(--ui-text-tertiary)' }, children: account.preferred ? 'ACTIVE' : 'USE' })
      ]
    }, `${account.provider}:${account.id}`))
  })
}

function FooterControl() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const usage = useValue(host.state.focusedUsage)
  const [resources, setResources] = useState(null)
  const [account, setAccount] = useState(null)
  const [connections, setConnections] = useState([])
  const [accountsByProvider, setAccountsByProvider] = useState({})
  const [busy, setBusy] = useState(false)

  const refreshResources = async () => {
    try { setResources(await host.request('system.resources', {})) } catch { setResources(null) }
  }
  const refreshAccount = async () => {
    try { setAccount(await host.request('account.usage', {})) } catch { setAccount(null) }
    const pairs = await Promise.all(PROVIDERS.map(async provider => {
      try {
        const result = await host.request('auth.accounts', { action: 'list', provider })
        return [provider, Array.isArray(result?.accounts) ? result.accounts : []]
      } catch { return [provider, []] }
    }))
    setAccountsByProvider(Object.fromEntries(pairs))
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try { const rows = await host.connections(); if (!cancelled) setConnections(rows) } catch {}
    })()
    void refreshResources()
    void refreshAccount()
    const resourceTimer = setInterval(refreshResources, REFRESH_RESOURCES_MS)
    const accountTimer = setInterval(refreshAccount, REFRESH_ACCOUNT_MS)
    return () => { cancelled = true; clearInterval(resourceTimer); clearInterval(accountTimer) }
  }, [connectionId])

  const source = useMemo(() => connections.find(row => row.id === connectionId) || connections.find(row => row.kind === 'local'), [connections, connectionId])
  const accountRemaining = account?.windows?.length ? Math.min(...account.windows.map(window => pct(window.remaining_percent)).filter(value => value !== null)) : null
  const accountUsed = accountRemaining === null ? null : 100 - accountRemaining
  const memoryPct = pct(resources?.memory?.percent)
  const contextPct = pct(usage?.context_percent)
  const compact = [
    `TKN ${accountUsed === null ? '—' : `${pct(accountUsed)}%`}`,
    `CTX ${contextPct === null ? '—' : `${contextPct}%`}`,
    `CPU ${pct(resources?.cpu_percent) === null ? '—' : `${pct(resources.cpu_percent)}%`}`,
    `RAM ${memoryPct === null ? '—' : `${memoryPct}%`}`,
    `DSK ${pct(resources?.disk?.percent) === null ? '—' : `${pct(resources.disk.percent)}%`}`
  ].join(' · ')

  const useAccount = async (provider, credentialId) => {
    setBusy(true)
    try {
      await host.request('auth.accounts', { action: 'use', provider, credential_id: credentialId })
      await refreshAccount()
      host.notify({ kind: 'success', message: `${providerLabel(provider)} account selected on ${source?.label || 'this gateway'}.` })
    } catch (error) {
      host.notify({ kind: 'error', message: error instanceof Error ? error.message : 'Could not switch account.' })
    } finally { setBusy(false) }
  }

  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsxs('button', {
          type: 'button',
          'aria-label': 'Account and gateway resources',
          style: {
            display: 'inline-flex', height: '100%', alignItems: 'center', gap: 6, paddingInline: 7,
            border: 0, borderRadius: 7, background: 'transparent', color: 'var(--ui-text-tertiary)',
            fontSize: '0.6875rem', whiteSpace: 'nowrap', cursor: 'pointer'
          },
          children: [jsx(Codicon, { name: gateway === 'open' ? 'pulse' : 'debug-disconnect', size: '0.75rem', style: { color: usageTone(accountUsed) } }), compact || 'Resources']
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        sideOffset: 8,
        style: { width: 360, padding: 12, borderRadius: 14 },
        children: jsxs('div', {
          style: { display: 'grid', gap: 12, fontSize: '0.72rem' },
          children: [
            jsxs('div', { children: [
              jsx('strong', { style: { display: 'block', fontSize: '0.82rem' }, children: source?.label || 'Current gateway' }),
              jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: `${resources?.hostname || connectionId || 'local'} · ${gateway}` })
            ] }),
            jsxs('div', { style: { display: 'grid', gap: 7 }, children: [
              jsx(Meter, { label: 'Account', value: accountRemaining === null ? null : 100 - accountRemaining }),
              jsx(Meter, { label: 'Context', value: contextPct }),
              jsx(Meter, { label: 'CPU', value: resources?.cpu_percent }),
              jsx(Meter, { label: 'RAM', value: resources?.memory?.percent }),
              jsx(Meter, { label: 'Disk', value: resources?.disk?.percent })
            ] }),
            jsxs('div', { style: { color: 'var(--ui-text-tertiary)', display: 'flex', justifyContent: 'space-between' }, children: [
              jsx('span', { children: `RAM ${gib(resources?.memory?.used)} / ${gib(resources?.memory?.total)}` }),
              jsx('span', { children: `Disk ${gib(resources?.disk?.used)} / ${gib(resources?.disk?.total)}` })
            ] }),
            jsx('div', { style: { height: 1, background: 'var(--ui-stroke-secondary)' } }),
            jsx(AccountRows, { accountsByProvider, onUse: useAccount }),
            jsxs('div', { style: { display: 'flex', gap: 7 }, children: [
              quietButton('Refresh', () => { void refreshResources(); void refreshAccount() }, busy),
              quietButton('Reconnect / add account', () => host.navigate('/settings?tab=providers'))
            ] })
          ]
        })
      })
    ]
  })
}

let terminalOpenedThisRun = false

function toggleTerminal() {
  if (!terminalOpenedThisRun) {
    terminalOpenedThisRun = true
    newTerminal()
    return
  }
  if (typeof host.togglePane === 'function') {
    host.togglePane('terminal')
    return
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true }))
}

function newTerminal() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, shiftKey: true, bubbles: true }))
}

export default {
  id: ID,
  name: 'Account & Resources Footer',
  description: 'Gateway-scoped account quota, context, CPU, RAM, disk, account switching and reconnect access.',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({ id: 'footer', area: STATUSBAR_AREAS.right, order: 35, render: () => jsx(FooterControl, {}) })
    ctx.register({
      id: 'terminal-titlebar',
      area: 'titleBar.tools.right',
      data: {
        id: 'account-resource-footer.terminal',
        label: 'Toggle terminal',
        actionId: 'view.showTerminal',
        icon: jsx(Codicon, { name: 'terminal', size: '0.85rem' }),
        onSelect: toggleTerminal
      }
    })
    ctx.register({
      id: 'new-terminal-titlebar',
      area: 'titleBar.tools.right',
      data: {
        id: 'account-resource-footer.new-terminal',
        label: 'New terminal',
        actionId: 'view.newTerminal',
        icon: jsx(Codicon, { name: 'add', size: '0.8rem' }),
        onSelect: newTerminal
      }
    })
  }
}
