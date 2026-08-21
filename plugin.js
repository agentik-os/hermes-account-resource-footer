import {
  Codicon,
  host,
  Popover,
  PopoverContent,
  PopoverTrigger,
  STATUSBAR_AREAS,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'account-resource-footer'
const REFRESH_RESOURCES_MS = 15_000
const REFRESH_ACCOUNT_MS = 60_000
const PROVIDERS = ['openai-codex', 'anthropic']
let runtimeCtx = null

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
  const profile = useValue(host.state.focusedSessionProfile)
  const [resources, setResources] = useState(null)
  const [account, setAccount] = useState(null)
  const [connections, setConnections] = useState([])
  const [accountsByProvider, setAccountsByProvider] = useState({})
  const [busy, setBusy] = useState(false)
  const [oauthFlow, setOauthFlow] = useState(null)
  const [oauthCode, setOauthCode] = useState('')
  const oauthFlowRef = useRef(null)
  const oauthGeneration = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    oauthFlowRef.current = oauthFlow
  }, [oauthFlow])

  useEffect(() => {
    oauthGeneration.current += 1
  }, [connectionId, profile])

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

  const requestFlow = (flow, method, params = {}) => host.requestProfile(flow.route, method, params)

  const beginOauth = async provider => {
    const generation = ++oauthGeneration.current
    setBusy(true)
    try {
      const targetProfile = profile || 'default'
      const activeConnection = connectionId || host.activeConnectionId?.()
      const routes = await host.profileRoutes()
      const route = routes.find(item =>
        item.connectionId === activeConnection &&
        (item.targetProfile === targetProfile || item.profile === targetProfile)
      )
      if (!route) throw new Error('The active gateway route is unavailable.')
      const flow = await host.requestProfile(route, 'auth.oauth.start', {
        provider,
        profile: route.targetProfile || targetProfile
      })
      const currentConnection = host.state.connectionId.get() || host.activeConnectionId?.() || null
      const currentProfile = host.state.focusedSessionProfile.get() || 'default'
      if (
        !mountedRef.current ||
        oauthGeneration.current !== generation ||
        currentConnection !== route.connectionId ||
        currentProfile !== (route.profile || targetProfile)
      ) {
        void host.requestProfile(route, 'auth.oauth.cancel', {
          provider,
          profile: route.targetProfile || targetProfile,
          session_id: flow.session_id
        }).catch(() => undefined)
        return
      }
      const next = {
        ...flow,
        provider,
        routeProfile: route.profile || targetProfile,
        targetProfile: route.targetProfile || targetProfile,
        connectionId: route.connectionId,
        route,
        status: 'pending'
      }
      setOauthFlow(next)
      setOauthCode('')
    } catch (error) {
      if (mountedRef.current && oauthGeneration.current === generation) {
        host.notify({ kind: 'error', message: error instanceof Error ? error.message : `Could not reconnect ${providerLabel(provider)}.` })
      }
    } finally {
      if (mountedRef.current && oauthGeneration.current === generation) setBusy(false)
    }
  }

  const submitOauth = async () => {
    if (!oauthFlow || oauthFlow.flow !== 'pkce' || !oauthCode.trim()) return
    const activeFlow = oauthFlow
    setBusy(true)
    try {
      const result = await requestFlow(activeFlow, 'auth.oauth.submit', {
        provider: activeFlow.provider,
        profile: activeFlow.targetProfile || undefined,
        session_id: activeFlow.session_id,
        code: oauthCode.trim()
      })
      if (oauthFlowRef.current?.session_id !== activeFlow.session_id) return
      if (result?.status !== 'approved') {
        setOauthFlow(current => current ? { ...current, status: result?.status || 'error' } : current)
        host.notify({ kind: 'error', message: `${providerLabel(activeFlow.provider)} authorization was not approved.` })
        return
      }
      setOauthFlow(null)
      setOauthCode('')
      await refreshAccount()
      host.notify({ kind: 'success', message: `${providerLabel(activeFlow.provider)} connected.` })
    } catch (error) {
      host.notify({ kind: 'error', message: error instanceof Error ? error.message : 'Could not submit the authorization code.' })
    } finally { setBusy(false) }
  }

  const cancelOauth = async () => {
    if (!oauthFlow) return
    const activeFlow = oauthFlow
    try {
      const result = await requestFlow(activeFlow, 'auth.oauth.cancel', {
        provider: activeFlow.provider,
        profile: activeFlow.targetProfile || undefined,
        session_id: activeFlow.session_id
      })
      if (oauthFlowRef.current?.session_id !== activeFlow.session_id) return
      if (result?.status === 'approved') {
        setOauthFlow(null)
        setOauthCode('')
        await refreshAccount()
        host.notify({ kind: 'success', message: `${providerLabel(activeFlow.provider)} connected before cancellation completed.` })
        return
      }
      if (result?.status !== 'cancelled') {
        setOauthFlow(current => current ? { ...current, status: result?.status || 'error' } : current)
        return
      }
    } catch {
      if (oauthFlowRef.current?.session_id === activeFlow.session_id) {
        setOauthFlow(current => current ? { ...current, status: 'error' } : current)
      }
      return
    }
    setOauthFlow(null)
    setOauthCode('')
  }

  useEffect(() => {
    if (!oauthFlow || oauthFlow.flow !== 'device_code' || oauthFlow.status !== 'pending') return
    const activeFlow = oauthFlow
    let stopped = false
    let failures = 0
    let timer = null
    const delay = Math.max(2000, Number(activeFlow.poll_interval || 5) * 1000)
    const schedule = () => {
      if (!stopped) timer = setTimeout(() => { void poll() }, delay)
    }
    const poll = async () => {
      try {
        const result = await requestFlow(activeFlow, 'auth.oauth.poll', {
          provider: activeFlow.provider,
          profile: activeFlow.targetProfile || undefined,
          session_id: activeFlow.session_id
        })
        if (stopped || oauthFlowRef.current?.session_id !== activeFlow.session_id) return
        failures = 0
        if (result?.status === 'approved') {
          setOauthFlow(null)
          await refreshAccount()
          host.notify({ kind: 'success', message: `${providerLabel(activeFlow.provider)} connected.` })
          return
        }
        if (['error', 'cancelled', 'denied', 'expired'].includes(result?.status)) {
          setOauthFlow(current => current ? { ...current, status: result.status } : current)
          return
        }
      } catch {
        failures += 1
        if (!stopped && failures >= 3) {
          setOauthFlow(current => current ? { ...current, status: 'error' } : current)
          return
        }
      }
      schedule()
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [oauthFlow?.session_id, oauthFlow?.status])

  useEffect(() => {
    if (!oauthFlow) return
    const currentConnection = connectionId || host.activeConnectionId?.() || null
    const currentProfile = profile || 'default'
    if (oauthFlow.connectionId === currentConnection && oauthFlow.routeProfile === currentProfile) return
    const stale = oauthFlow
    setOauthFlow(null)
    setOauthCode('')
    void requestFlow(stale, 'auth.oauth.cancel', {
      provider: stale.provider,
      profile: stale.targetProfile || undefined,
      session_id: stale.session_id
    }).catch(() => undefined)
  }, [connectionId, profile, oauthFlow?.session_id])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      oauthGeneration.current += 1
      const active = oauthFlowRef.current
      if (!active || active.status !== 'pending') return
      void requestFlow(active, 'auth.oauth.cancel', {
        provider: active.provider,
        profile: active.targetProfile || undefined,
        session_id: active.session_id
      }).catch(() => undefined)
      oauthFlowRef.current = null
    }
  }, [])

  const openOauthUrl = async () => {
    const url = oauthFlow?.verification_url || oauthFlow?.auth_url
    if (!url || !runtimeCtx?.os?.openExternal) return
    try {
      const opened = await runtimeCtx.os.openExternal(url)
      if (!opened) throw new Error('The system browser did not accept the authorization URL.')
    } catch (error) {
      host.notify({ kind: 'error', message: error instanceof Error ? error.message : 'Could not open the authorization page.' })
    }
  }

  const pasteOauthCode = async () => {
    try {
      const value = await navigator.clipboard.readText()
      if (value) setOauthCode(value.trim())
    } catch {
      host.notify({ kind: 'warning', message: 'Clipboard access is unavailable. Paste the code manually.' })
    }
  }

  const expectsPastedCode = Boolean(oauthFlow?.flow === 'pkce')
  const oauthModal = oauthFlow ? jsx('div', {
    role: 'presentation',
    style: {
      position: 'fixed', inset: 0, zIndex: 2147483000, display: 'grid', placeItems: 'center',
      padding: 20, background: 'rgb(0 0 0 / 42%)'
    },
    children: jsxs('div', {
      role: 'dialog',
      'aria-modal': true,
      'aria-label': `Connect ${providerLabel(oauthFlow.provider)}`,
      style: {
        position: 'relative', display: 'grid', gap: 13, width: 'min(460px, calc(100vw - 40px))',
        padding: 18, border: '1px solid var(--ui-stroke-secondary)', borderRadius: 16,
        background: 'var(--theme-elevated-seed, var(--dt-background))', color: 'var(--ui-text-primary)',
        boxShadow: '0 20px 60px rgb(0 0 0 / 28%)', fontSize: '0.78rem'
      },
      children: [
        jsx('button', {
          type: 'button', 'aria-label': 'Close authorization', onClick: () => { void cancelOauth() },
          style: { position: 'absolute', top: 10, right: 10, display: 'grid', placeItems: 'center', width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ui-text-secondary)', cursor: 'pointer', fontSize: '1.1rem' },
          children: '×'
        }),
        jsxs('div', { style: { paddingRight: 28 }, children: [
          jsx('strong', { style: { display: 'block', fontSize: '0.98rem' }, children: `Connect ${providerLabel(oauthFlow.provider)}` }),
          jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: oauthFlow.status || 'pending' })
        ] }),
        jsx('div', {
          style: { color: 'var(--ui-text-secondary)', lineHeight: 1.5 },
          children: oauthFlow.user_code
            ? 'Open the authorization page, sign in, then enter the one-time code shown below in the website.'
            : 'Open the authorization page, sign in, then copy the code shown by the website and paste it below.'
        }),
        quietButton('Open authorization page', openOauthUrl, busy),
        oauthFlow.user_code ? jsxs('div', {
          style: { display: 'grid', gap: 7, padding: 11, borderRadius: 10, background: 'var(--ui-bg-quaternary)' },
          children: [
            jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: 'Code to enter in the website' }),
            jsx('code', { style: { fontSize: '1rem', letterSpacing: '0.12em', userSelect: 'all' }, children: oauthFlow.user_code }),
            quietButton('Copy code', () => { void runtimeCtx?.os?.writeClipboard?.(oauthFlow.user_code) })
          ]
        }) : null,
        expectsPastedCode ? jsxs('div', { style: { display: 'grid', gap: 7 }, children: [
          jsx('label', { htmlFor: 'hermes-oauth-code', style: { color: 'var(--ui-text-tertiary)' }, children: 'Authorization code from the website' }),
          jsx('input', {
            id: 'hermes-oauth-code', value: oauthCode, autoFocus: true,
            onChange: event => setOauthCode(event.target.value),
            placeholder: `Paste the ${providerLabel(oauthFlow.provider)} authorization code`,
            'aria-label': `${providerLabel(oauthFlow.provider)} authorization code`,
            style: { minHeight: 38, padding: '7px 9px', borderRadius: 9, border: '1px solid var(--ui-stroke-secondary)', background: 'var(--ui-editor-background)', color: 'var(--ui-text-primary)' }
          }),
          jsxs('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' }, children: [
            quietButton('Paste', () => { void pasteOauthCode() }, busy),
            quietButton('Connect', () => { void submitOauth() }, busy || !oauthCode.trim())
          ] })
        ] }) : null,
        quietButton('Cancel', () => { void cancelOauth() }, busy)
      ]
    })
  }) : null

  return jsxs('div', {
    style: { display: 'contents' },
    children: [jsxs(Popover, {
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
            jsxs('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' }, children: [
              quietButton('Refresh', () => { void refreshResources(); void refreshAccount() }, busy),
              quietButton('Connect OpenAI', () => { void beginOauth('openai-codex') }, busy || Boolean(oauthFlow)),
              quietButton('Connect Claude', () => { void beginOauth('anthropic') }, busy || Boolean(oauthFlow))
            ] })
          ]
        })
      })
    ]
    }), oauthModal]
  })
}

let terminalOpenedThisRun = false

function openFreshTerminal() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, shiftKey: true, bubbles: true }))
}

function toggleTerminal() {
  if (!terminalOpenedThisRun) {
    terminalOpenedThisRun = true
    openFreshTerminal()
    return
  }
  if (typeof host.togglePane === 'function') {
    host.togglePane('terminal')
    return
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true }))
}

function toggleThemeMode() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', shiftKey: true, bubbles: true }))
}

export default {
  id: ID,
  name: 'Account & Resources Footer',
  description: 'Gateway-scoped account quota, context, CPU, RAM, disk, account switching and reconnect access.',
  defaultEnabled: true,
  register(ctx) {
    runtimeCtx = ctx
    ctx.onDispose(() => { if (runtimeCtx === ctx) runtimeCtx = null })
    ctx.register({ id: 'footer', area: STATUSBAR_AREAS.right, order: 35, render: () => jsx(FooterControl, {}) })
    const nativeControls = document.querySelector(
      'button[aria-label="Switch to light theme"], button[aria-label="Switch to dark theme"]'
    )
    if (nativeControls) return
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
      id: 'theme-mode-titlebar',
      area: 'titleBar.tools.right',
      data: {
        id: 'account-resource-footer.theme-mode',
        label: 'Toggle light / dark theme',
        actionId: 'appearance.toggleMode',
        icon: jsx(Codicon, { name: 'color-mode', size: '0.82rem' }),
        onSelect: toggleThemeMode
      }
    })
  }
}
