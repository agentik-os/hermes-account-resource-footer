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
let retainedOauthFlow = null
let retainedOauthCode = ''

export function createScopeFence() {
  let generation = 0

  return {
    bump: () => ++generation,
    capture: () => generation,
    isCurrent: value => value === generation
  }
}

export function createLatestRequestFence() {
  let generation = 0

  return {
    begin: () => ++generation,
    invalidate: () => ++generation,
    isCurrent: value => value === generation
  }
}

const pct = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : null)
const gib = value => (Number.isFinite(Number(value)) ? `${(Number(value) / 1024 ** 3).toFixed(1)} GB` : '—')
const providerLabel = value => value === 'openai-codex' ? 'OpenAI' : value === 'anthropic' ? 'Anthropic API' : value === 'claude-code' ? 'Claude Code' : value || 'Account'
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

function AccountQuota({ usage }) {
  const windows = Array.isArray(usage?.windows)
    ? usage.windows.filter(window => pct(window?.used_percent) !== null).slice(0, 2)
    : []
  if (!windows.length) {
    return jsx('small', {
      style: { color: 'var(--ui-text-tertiary)', fontSize: '0.66rem' },
      children: usage ? 'Quota unavailable' : 'Checking quota…'
    })
  }
  return jsx('span', {
    style: { display: 'grid', gap: 4, marginTop: 5 },
    children: windows.map((window, index) => {
      const used = pct(window.used_percent)
      const remaining = pct(window.remaining_percent ?? (used === null ? null : 100 - used))
      return jsxs('span', {
        title: window.reset_at ? `Resets ${new Date(window.reset_at).toLocaleString()}` : undefined,
        style: { display: 'grid', gridTemplateColumns: '54px minmax(42px, 1fr) auto', gap: 6, alignItems: 'center' },
        children: [
          jsx('small', { style: { color: 'var(--ui-text-tertiary)', fontSize: '0.64rem' }, children: window.label || 'Quota' }),
          jsx('span', {
            style: { height: 4, overflow: 'hidden', borderRadius: 999, background: 'var(--ui-stroke-tertiary)' },
            children: jsx('span', {
              style: { display: 'block', width: `${used ?? 0}%`, height: '100%', borderRadius: 999, background: usageTone(used) }
            })
          }),
          jsx('small', {
            style: { color: 'var(--ui-text-secondary)', fontSize: '0.64rem', whiteSpace: 'nowrap' },
            children: `${used ?? '—'}% used · ${remaining ?? '—'}% left`
          })
        ]
      }, `${window.label || String(window.reset_at || used)}:${index}`)
    })
  })
}

function AccountRows({ accountsByProvider, onUse, busy }) {
  const rows = PROVIDERS.flatMap(provider => (accountsByProvider[provider] || []).map(account => ({ ...account, provider })))
  if (!rows.length) return jsx('div', { style: { color: 'var(--ui-text-tertiary)' }, children: 'No pooled Claude/OpenAI account on this gateway.' })
  return jsx('div', {
    style: { display: 'grid', gap: 5 },
    children: rows.map(account => jsxs('button', {
      type: 'button',
      disabled: busy,
      onClick: () => onUse(account.provider, account.id),
      style: {
        display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8,
        padding: '7px 8px', borderRadius: 9,
        border: account.active
          ? '1px solid var(--ui-accent)'
          : account.preferred
            ? '1px solid var(--ui-stroke-primary)'
            : '1px solid var(--ui-stroke-secondary)',
        background: account.active
          ? 'color-mix(in srgb, var(--ui-accent) 10%, transparent)'
          : account.preferred
            ? 'color-mix(in srgb, var(--ui-text-primary) 5%, transparent)'
            : 'transparent',
        color: 'var(--ui-text-primary)', textAlign: 'left', cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1
      },
      children: [
        jsxs('span', { style: { minWidth: 0 }, children: [
          jsx('strong', { style: { display: 'block', fontSize: '0.75rem' }, children: account.label || account.id }),
          jsx('small', {
            style: { color: 'var(--ui-text-tertiary)' },
            children: `${providerLabel(account.provider)}${account.usage?.plan ? ` ${account.usage.plan}` : ''} · ${account.status || 'ok'}`
          }),
          jsx(AccountQuota, { usage: account.usage })
        ] }),
        jsx('span', {
          style: {
            fontSize: '0.68rem',
            color: account.active
              ? 'var(--ui-accent)'
              : account.preferred
                ? 'var(--ui-text-secondary)'
                : 'var(--ui-text-tertiary)'
          },
          children: account.active ? 'ACTIVE' : account.preferred ? 'PREFERRED' : 'USE'
        })
      ]
    }, `${account.provider}:${account.id}`))
  })
}

function ClaudeCodeRows({ accounts, busy, onConnect }) {
  if (!accounts.length) {
    return jsx('div', { style: { color: 'var(--ui-text-tertiary)' }, children: 'Claude Code status is unavailable on this gateway.' })
  }
  return jsx('div', {
    style: { display: 'grid', gap: 5 },
    children: accounts.map(account => {
      const connected = account.loggedIn === true
      const plan = account.subscriptionType ? String(account.subscriptionType).toUpperCase() : null
      return jsxs('button', {
        type: 'button',
        disabled: busy,
        onClick: () => onConnect(account.label),
        style: {
          display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8,
          padding: '7px 8px', borderRadius: 9, border: '1px solid var(--ui-stroke-secondary)',
          background: connected ? 'color-mix(in srgb, var(--ui-success) 8%, transparent)' : 'transparent',
          color: 'var(--ui-text-primary)', textAlign: 'left', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1
        },
        children: [
          jsxs('span', { children: [
            jsx('strong', { style: { display: 'block', fontSize: '0.75rem' }, children: account.label === 'default' ? 'Default Claude Code' : account.label }),
            jsx('small', {
              style: { color: 'var(--ui-text-tertiary)' },
              children: `Claude Code${plan ? ` · ${plan}` : ''} · ${connected ? 'connected' : account.loggedIn === false ? 'logged out' : 'status unknown'}`
            })
          ] }),
          jsx('span', {
            style: { fontSize: '0.68rem', color: connected ? 'var(--ui-success)' : 'var(--ui-text-tertiary)' },
            children: connected ? 'READY' : 'CONNECT'
          })
        ]
      }, account.label)
    })
  })
}

function FooterControl() {
  const connectionId = useValue(host.state.connectionId)
  const activeSessionId = useValue(host.state.activeSessionId)
  const gateway = useValue(host.state.gateway)
  const usage = useValue(host.state.focusedUsage)
  const profile = useValue(host.state.profile)
  const [resources, setResources] = useState(null)
  const [account, setAccount] = useState(null)
  const [connections, setConnections] = useState([])
  const [accountsByProvider, setAccountsByProvider] = useState({})
  const [claudeAccounts, setClaudeAccounts] = useState([])
  const [claudeAccountId, setClaudeAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [oauthFlow, setOauthFlowState] = useState(() => retainedOauthFlow)
  const [oauthCode, setOauthCodeState] = useState(() => retainedOauthCode)
  const oauthFlowRef = useRef(retainedOauthFlow)
  const oauthGeneration = useRef(0)
  const busyGeneration = useRef(0)
  const scopeFenceRef = useRef(null)
  const accountRefreshFenceRef = useRef(null)
  const resourceRefreshFenceRef = useRef(null)
  const mountedRef = useRef(true)

  if (!scopeFenceRef.current) scopeFenceRef.current = createScopeFence()
  if (!accountRefreshFenceRef.current) accountRefreshFenceRef.current = createLatestRequestFence()
  if (!resourceRefreshFenceRef.current) resourceRefreshFenceRef.current = createLatestRequestFence()
  const startBusy = () => {
    const generation = ++busyGeneration.current
    setBusy(true)
    return generation
  }
  const finishBusy = generation => {
    if (mountedRef.current && busyGeneration.current === generation) setBusy(false)
  }

  const setOauthFlow = nextValue => {
    const next = typeof nextValue === 'function' ? nextValue(oauthFlowRef.current) : nextValue
    retainedOauthFlow = next
    oauthFlowRef.current = next
    setOauthFlowState(next)
  }
  const setOauthCode = next => {
    retainedOauthCode = next
    setOauthCodeState(next)
  }

  useEffect(() => {
    scopeFenceRef.current.bump()
    accountRefreshFenceRef.current.invalidate()
    resourceRefreshFenceRef.current.invalidate()
    setResources(null)
    setAccount(null)
    setAccountsByProvider({})
    setClaudeAccounts([])
  }, [activeSessionId, connectionId, profile])

  const refreshResources = async () => {
    const scopeGeneration = scopeFenceRef.current.capture()
    const refreshGeneration = resourceRefreshFenceRef.current.begin()
    let next = null
    try {
      const { route } = await resolveActiveRoute()
      next = await host.requestProfile(route, 'system.resources', {})
    } catch {}
    if (
      !mountedRef.current ||
      !scopeFenceRef.current.isCurrent(scopeGeneration) ||
      !resourceRefreshFenceRef.current.isCurrent(refreshGeneration)
    ) return
    setResources(next)
  }
  const refreshAccount = async () => {
    const scopeGeneration = scopeFenceRef.current.capture()
    const refreshGeneration = accountRefreshFenceRef.current.begin()
    let resolvedRoute
    try {
      resolvedRoute = await resolveActiveRoute()
    } catch {
      if (
        mountedRef.current &&
        scopeFenceRef.current.isCurrent(scopeGeneration) &&
        accountRefreshFenceRef.current.isCurrent(refreshGeneration)
      ) {
        setAccount(null)
        setAccountsByProvider({})
        setClaudeAccounts([])
      }
      return
    }
    const targetProfile = resolvedRoute.route.targetProfile || resolvedRoute.targetProfile
    const requestRoute = (method, params) => host.requestProfile(
      resolvedRoute.route,
      method,
      params
    )
    const [nextAccount, pairs, cliResult] = await Promise.all([
      requestRoute('account.usage', { profile: targetProfile }).catch(() => null),
      Promise.all(PROVIDERS.map(async provider => {
        try {
          const result = await requestRoute('auth.accounts', {
            action: 'list',
            provider,
            profile: targetProfile,
            ...(activeSessionId ? { session_id: activeSessionId } : {})
          })
          return [provider, Array.isArray(result?.accounts) ? result.accounts : []]
        } catch { return [provider, []] }
      })),
      requestRoute('auth.cli.accounts', {
        provider: 'claude-code',
        profile: targetProfile
      }).catch(() => null)
    ])
    if (
      !mountedRef.current ||
      !scopeFenceRef.current.isCurrent(scopeGeneration) ||
      !accountRefreshFenceRef.current.isCurrent(refreshGeneration)
    ) return
    setAccount(nextAccount)
    setAccountsByProvider(Object.fromEntries(pairs))
    setClaudeAccounts(Array.isArray(cliResult?.accounts) ? cliResult.accounts : [])
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
  }, [activeSessionId, connectionId, profile])

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
    const busyToken = startBusy()
    const scope = scopeFenceRef.current.capture()
    try {
      const { route, targetProfile } = await resolveActiveRoute()
      const result = await host.requestProfile(route, 'auth.accounts', {
        action: 'use',
        provider,
        credential_id: credentialId,
        profile: route.targetProfile || targetProfile,
        ...(activeSessionId ? { session_id: activeSessionId } : {})
      })
      if (!mountedRef.current || !scopeFenceRef.current.isCurrent(scope)) return
      await refreshAccount()
      if (!mountedRef.current || !scopeFenceRef.current.isCurrent(scope)) return
      if (result?.superseded) return
      const queuedForActiveSession = Boolean(
        activeSessionId && result?.pending_session_id === activeSessionId
      )
      host.notify({
        kind: 'success',
        message: queuedForActiveSession
          ? `${providerLabel(provider)} account will apply to the active chat on its next turn.`
          : `${providerLabel(provider)} account preference saved on ${source?.label || 'this gateway'} for future eligible selections.`
      })
    } catch (error) {
      if (mountedRef.current && scopeFenceRef.current.isCurrent(scope)) {
        host.notify({ kind: 'error', message: error instanceof Error ? error.message : 'Could not switch account.' })
      }
    } finally { finishBusy(busyToken) }
  }

  const requestFlow = (flow, method, params = {}) => host.requestProfile(
    flow.route,
    method,
    {
      ...params,
      profile: params.profile || flow.targetProfile || flow.routeProfile || 'default'
    }
  )
  const flowMatchesCurrentScope = flow => {
    const currentConnection = host.state.connectionId.get() || host.activeConnectionId?.() || null
    const currentProfile = host.state.profile.get() || 'default'

    return Boolean(flow) && flow.connectionId === currentConnection && flow.routeProfile === currentProfile
  }

  const resolveActiveRoute = async () => {
    const targetProfile = profile || 'default'
    const activeConnection = connectionId || host.activeConnectionId?.()
    const routes = await host.profileRoutes()
    const matches = routes.filter(item =>
      item.connectionId === activeConnection &&
      item.profile === targetProfile
    )
    if (matches.length !== 1) {
      throw new Error(
        matches.length
          ? 'The active gateway route is ambiguous.'
          : 'The active gateway route is unavailable.'
      )
    }
    const route = matches[0]
    return { route, targetProfile }
  }

  const beginOauth = async provider => {
    const generation = ++oauthGeneration.current
    const busyToken = startBusy()
    try {
      const { route, targetProfile } = await resolveActiveRoute()
      const flow = await host.requestProfile(route, 'auth.oauth.start', {
        provider,
        profile: route.targetProfile || targetProfile
      })
      if (
        !mountedRef.current ||
        oauthGeneration.current !== generation
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
        kind: 'oauth',
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
      finishBusy(busyToken)
    }
  }

  const beginCliOauth = async rawAccountId => {
    const accountId = String(rawAccountId || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(accountId)) {
      host.notify({ kind: 'warning', message: 'Use 1 to 32 lowercase letters, numbers or hyphens for the Claude Code profile name.' })
      return
    }
    const generation = ++oauthGeneration.current
    const busyToken = startBusy()
    try {
      const { route, targetProfile } = await resolveActiveRoute()
      const flow = await host.requestProfile(route, 'auth.cli.start', {
        provider: 'claude-code',
        account_id: accountId,
        profile: route.targetProfile || targetProfile
      })
      if (!mountedRef.current || oauthGeneration.current !== generation) {
        void host.requestProfile(route, 'auth.cli.cancel', {
          provider: 'claude-code',
          account_id: accountId,
          profile: route.targetProfile || targetProfile,
          session_id: flow.session_id
        }).catch(() => undefined)
        return
      }
      setOauthFlow({
        ...flow,
        kind: 'cli',
        flow: 'cli',
        provider: 'claude-code',
        accountId,
        routeProfile: route.profile || targetProfile,
        targetProfile: route.targetProfile || targetProfile,
        connectionId: route.connectionId,
        route,
        status: 'pending'
      })
      setOauthCode('')
      setClaudeAccountId('')
    } catch (error) {
      if (mountedRef.current && oauthGeneration.current === generation) {
        host.notify({ kind: 'error', message: error instanceof Error ? error.message : 'Could not start Claude Code authorization.' })
      }
    } finally {
      finishBusy(busyToken)
    }
  }

  const submitOauth = async () => {
    const isCliFlow = oauthFlow?.kind === 'cli'
    if (!oauthFlow || (!isCliFlow && oauthFlow.flow !== 'pkce') || !oauthCode.trim()) return
    const activeFlow = oauthFlow
    const scope = scopeFenceRef.current.capture()
    const busyToken = startBusy()
    try {
      const result = await requestFlow(
        activeFlow,
        isCliFlow ? 'auth.cli.submit' : 'auth.oauth.submit',
        isCliFlow
          ? {
              provider: activeFlow.provider,
              account_id: activeFlow.accountId,
              session_id: activeFlow.session_id,
              code: oauthCode.trim()
            }
          : {
              provider: activeFlow.provider,
              profile: activeFlow.targetProfile || undefined,
              session_id: activeFlow.session_id,
              code: oauthCode.trim()
            }
      )
      if (
        oauthFlowRef.current?.session_id !== activeFlow.session_id ||
        !mountedRef.current
      ) return
      if (isCliFlow && result?.status === 'pending') {
        setOauthFlow(current => current ? {
          ...current,
          ...result,
          status: 'pending'
        } : current)
        return
      }
      if (result?.status !== 'approved') {
        setOauthFlow(current => current ? {
          ...current,
          ...result,
          status: result?.status || 'error'
        } : current)
        if (flowMatchesCurrentScope(activeFlow) && scopeFenceRef.current.isCurrent(scope)) {
          host.notify({ kind: 'error', message: `${providerLabel(activeFlow.provider)} authorization was not approved.` })
        }
        return
      }
      const matchesCurrentScope = flowMatchesCurrentScope(activeFlow)
      setOauthFlow(current => current ? {
        ...current,
        ...result,
        status: 'approved'
      } : current)
      if (!matchesCurrentScope) return
      await refreshAccount()
      if (
        !mountedRef.current ||
        oauthFlowRef.current?.session_id !== activeFlow.session_id ||
        !flowMatchesCurrentScope(activeFlow) ||
        !scopeFenceRef.current.isCurrent(scope)
      ) return
      host.notify({ kind: 'success', message: `${providerLabel(activeFlow.provider)} connected.` })
    } catch (error) {
      if (mountedRef.current && oauthFlowRef.current?.session_id === activeFlow.session_id) {
        setOauthFlow(current => current ? { ...current, status: 'error' } : current)
      }
      if (mountedRef.current && flowMatchesCurrentScope(activeFlow) && scopeFenceRef.current.isCurrent(scope)) {
        host.notify({ kind: 'error', message: error instanceof Error ? error.message : 'Could not submit the authorization code.' })
      }
    } finally { finishBusy(busyToken) }
  }

  const closeOauth = () => {
    const activeFlow = oauthFlowRef.current
    oauthGeneration.current += 1
    busyGeneration.current += 1
    setBusy(false)
    setOauthFlow(null)
    setOauthCode('')
    if (!activeFlow) return
    const isCliFlow = activeFlow.kind === 'cli'
    void requestFlow(
      activeFlow,
      isCliFlow ? 'auth.cli.cancel' : 'auth.oauth.cancel',
      isCliFlow
        ? {
            provider: activeFlow.provider,
            account_id: activeFlow.accountId,
            session_id: activeFlow.session_id
          }
        : {
            provider: activeFlow.provider,
            profile: activeFlow.targetProfile || undefined,
            session_id: activeFlow.session_id
          }
    ).catch(() => {})
  }

  useEffect(() => {
    if (!oauthFlow) return
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); closeOauth() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [oauthFlow?.session_id])

  useEffect(() => {
    const isCliFlow = oauthFlow?.kind === 'cli'
    if (!oauthFlow || (!isCliFlow && oauthFlow.flow !== 'device_code') || oauthFlow.status !== 'pending') return
    const activeFlow = oauthFlow
    const scope = scopeFenceRef.current.capture()
    let stopped = false
    let failures = 0
    let timer = null
    const delay = Math.max(isCliFlow ? 1000 : 2000, Number(activeFlow.poll_interval || (isCliFlow ? 1 : 5)) * 1000)
    const schedule = () => {
      if (!stopped && mountedRef.current && oauthFlowRef.current?.session_id === activeFlow.session_id) {
        timer = setTimeout(() => { void poll() }, delay)
      }
    }
    const poll = async () => {
      try {
        const result = await requestFlow(
          activeFlow,
          isCliFlow ? 'auth.cli.poll' : 'auth.oauth.poll',
          isCliFlow
            ? {
                provider: activeFlow.provider,
                account_id: activeFlow.accountId,
                session_id: activeFlow.session_id
              }
            : {
                provider: activeFlow.provider,
                profile: activeFlow.targetProfile || undefined,
                session_id: activeFlow.session_id
              }
        )
        if (
          stopped ||
          !mountedRef.current ||
          oauthFlowRef.current?.session_id !== activeFlow.session_id
        ) return
        failures = 0
        if (result?.status === 'approved') {
          const matchesCurrentScope = flowMatchesCurrentScope(activeFlow)
          setOauthFlow(current => current ? {
            ...current,
            ...result,
            status: 'approved'
          } : current)
          if (!matchesCurrentScope) return
          await refreshAccount()
          if (
            !mountedRef.current ||
            oauthFlowRef.current?.session_id !== activeFlow.session_id ||
            !flowMatchesCurrentScope(activeFlow) ||
            !scopeFenceRef.current.isCurrent(scope)
          ) return
          host.notify({ kind: 'success', message: `${providerLabel(activeFlow.provider)} connected.` })
          return
        }
        if (['error', 'cancelled', 'denied', 'expired'].includes(result?.status)) {
          setOauthFlow(current => current ? {
            ...current,
            ...result,
            status: result.status
          } : current)
          return
        }
        if (isCliFlow) {
          setOauthFlow(current => current ? {
            ...current,
            ...result,
            status: 'pending'
          } : current)
        }
      } catch {
        if (!mountedRef.current || oauthFlowRef.current?.session_id !== activeFlow.session_id) return
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
  }, [oauthFlow?.session_id, oauthFlow?.status, oauthFlow?.kind])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      oauthGeneration.current += 1
    }
  }, [])

  const openOauthUrl = async event => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
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

  const authorizationUrl = oauthFlow?.verification_url || oauthFlow?.auth_url
  const expectsPastedCode = Boolean(oauthFlow?.flow === 'pkce' || (oauthFlow?.kind === 'cli' && oauthFlow?.expects_code))
  const oauthTitle = oauthFlow
    ? `Connect ${providerLabel(oauthFlow.provider)}${oauthFlow.accountId && oauthFlow.accountId !== 'default' ? ` · ${oauthFlow.accountId}` : ''}`
    : 'Connect account'
  const oauthScopeChanged = Boolean(oauthFlow && !flowMatchesCurrentScope(oauthFlow))
  const oauthModal = oauthFlow ? jsx('div', {
    role: 'presentation',
    onClick: event => event.stopPropagation(),
    onPointerDown: event => event.stopPropagation(),
    style: {
      position: 'fixed', inset: 0, zIndex: 2147483000, display: 'grid', placeItems: 'center',
      padding: 20, background: 'rgb(0 0 0 / 42%)'
    },
    children: jsxs('div', {
      role: 'dialog',
      'aria-modal': true,
      'aria-label': oauthTitle,
      style: {
        position: 'relative', display: 'grid', gap: 13, width: 'min(460px, calc(100vw - 40px))',
        padding: 18, border: '1px solid var(--ui-stroke-secondary)', borderRadius: 16,
        background: 'var(--theme-elevated-seed, var(--dt-background))', color: 'var(--ui-text-primary)',
        boxShadow: '0 20px 60px rgb(0 0 0 / 28%)', fontSize: '0.78rem'
      },
      children: [
        jsx('button', {
          type: 'button', 'aria-label': 'Close authorization', onClick: closeOauth,
          style: { position: 'absolute', top: 10, right: 10, display: 'grid', placeItems: 'center', width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ui-text-secondary)', cursor: 'pointer', fontSize: '1.1rem' },
          children: '×'
        }),
        jsxs('div', { style: { paddingRight: 28 }, children: [
          jsx('strong', { style: { display: 'block', fontSize: '0.98rem' }, children: oauthTitle }),
          jsx('span', {
            style: { color: 'var(--ui-text-tertiary)' },
            children: `${oauthFlow.status || 'pending'}${oauthFlow.subscriptionType ? ` · ${String(oauthFlow.subscriptionType).toUpperCase()}` : ''}`
          })
        ] }),
        oauthScopeChanged ? jsx('div', {
          role: 'status',
          style: { color: 'var(--ui-warning, #f59e0b)', lineHeight: 1.45 },
          children: `Authorization remains pinned to ${oauthFlow.routeProfile || 'default'} on ${oauthFlow.connectionId || 'its original gateway'}. Switch back to refresh that account view.`
        }) : null,
        jsxs('ol', {
          style: { display: 'grid', gap: 4, margin: 0, paddingLeft: 20, color: 'var(--ui-text-secondary)', lineHeight: 1.5 },
          children: oauthFlow.user_code
            ? [
                jsx('li', { children: 'Open the authorization page and sign in.' }),
                jsx('li', { children: 'Enter the one-time code shown below on that page.' }),
                jsx('li', { children: 'Return here. This dialog stays open while authorization finishes.' })
              ]
            : [
                jsx('li', { children: 'Open the authorization page and sign in.' }),
                jsx('li', { children: 'Copy the authorization code shown by the website.' }),
                jsx('li', { children: 'Return here, paste the code below, then select Connect.' })
              ]
        }),
        quietButton(authorizationUrl ? 'Open authorization page' : 'Preparing authorization page…', openOauthUrl, busy || !authorizationUrl),
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
            disabled: busy || oauthFlow.status === 'approved',
            placeholder: `Paste the ${providerLabel(oauthFlow.provider)} authorization code`,
            'aria-label': `${providerLabel(oauthFlow.provider)} authorization code`,
            style: { minHeight: 38, padding: '7px 9px', borderRadius: 9, border: '1px solid var(--ui-stroke-secondary)', background: 'var(--ui-editor-background)', color: 'var(--ui-text-primary)' }
          }),
          jsxs('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' }, children: [
            quietButton('Paste', () => { void pasteOauthCode() }, busy || oauthFlow.status === 'approved'),
            quietButton('Connect', () => { void submitOauth() }, busy || oauthFlow.status === 'approved' || !oauthCode.trim())
          ] })
        ] }) : null,
        quietButton(oauthFlow.status === 'approved' ? 'Done' : 'Cancel', closeOauth, false)
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
            jsx(AccountRows, { accountsByProvider, onUse: useAccount, busy }),
            jsxs('div', { style: { display: 'grid', gap: 7 }, children: [
              jsx('strong', { style: { fontSize: '0.75rem' }, children: 'Claude Code profiles' }),
              jsx(ClaudeCodeRows, {
                accounts: claudeAccounts,
                busy: busy || Boolean(oauthFlow),
                onConnect: accountId => { void beginCliOauth(accountId) }
              }),
              jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 7 }, children: [
                jsx('input', {
                  value: claudeAccountId,
                  disabled: busy || Boolean(oauthFlow),
                  onChange: event => setClaudeAccountId(event.target.value.toLowerCase()),
                  onKeyDown: event => {
                    if (event.key === 'Enter' && claudeAccountId.trim()) {
                      event.preventDefault()
                      void beginCliOauth(claudeAccountId)
                    }
                  },
                  placeholder: 'New profile name',
                  'aria-label': 'New Claude Code profile name',
                  style: { minWidth: 0, minHeight: 30, padding: '5px 8px', borderRadius: 9, border: '1px solid var(--ui-stroke-secondary)', background: 'var(--ui-editor-background)', color: 'var(--ui-text-primary)', fontSize: '0.72rem' }
                }),
                quietButton('Connect Claude Code', () => { void beginCliOauth(claudeAccountId) }, busy || Boolean(oauthFlow) || !claudeAccountId.trim())
              ] })
            ] }),
            jsxs('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' }, children: [
              quietButton('Refresh', () => { void refreshResources(); void refreshAccount() }, busy),
              quietButton('Connect OpenAI', () => { void beginOauth('openai-codex') }, busy || Boolean(oauthFlow)),
              quietButton('Connect Anthropic API', () => { void beginOauth('anthropic') }, busy || Boolean(oauthFlow))
            ] })
          ]
        })
      })
    ]
    }), oauthModal]
  })
}

export default {
  id: ID,
  name: 'Account & Resources Footer',
  description: 'Gateway-scoped account quota, context, CPU, RAM, disk, account switching and reconnect access.',
  defaultEnabled: true,
  required: true,
  register(ctx) {
    runtimeCtx = ctx
    ctx.onDispose(() => { if (runtimeCtx === ctx) runtimeCtx = null })
    ctx.register({ id: 'footer', area: STATUSBAR_AREAS.right, order: 35, render: () => jsx(FooterControl, {}) })
  }
}
