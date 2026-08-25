import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

function loadScopeFence() {
  const start = source.indexOf('export function createScopeFence()')
  const end = source.indexOf('\n}\n\nexport function createLatestRequestFence()', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const declaration = source.slice(start, end + 2).replace('export ', '')
  return Function(`${declaration}; return createScopeFence`)()
}

function loadLatestRequestFence() {
  const start = source.indexOf('export function createLatestRequestFence()')
  const end = source.indexOf('\n}\n\nconst pct', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const declaration = source.slice(start, end + 2).replace('export ', '')
  return Function(`${declaration}; return createLatestRequestFence`)()
}

function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}

test('a delayed account response cannot overwrite a newer gateway or profile scope', async () => {
  const createScopeFence = loadScopeFence()
  const fence = createScopeFence()
  const commits = []
  const requestA = deferred()
  const requestB = deferred()

  const commitWhenCurrent = async request => {
    const generation = fence.capture()
    const value = await request.promise
    if (fence.isCurrent(generation)) commits.push(value)
  }

  const pendingA = commitWhenCurrent(requestA)
  fence.bump()
  const pendingB = commitWhenCurrent(requestB)
  requestB.resolve('gateway-b')
  await pendingB
  requestA.resolve('gateway-a')
  await pendingA

  assert.deepEqual(commits, ['gateway-b'])
})

test('a delayed refresh cannot overwrite a newer refresh in the same scope', async () => {
  const createLatestRequestFence = loadLatestRequestFence()
  const fence = createLatestRequestFence()
  const commits = []
  const requestA = deferred()
  const requestB = deferred()

  const commitWhenLatest = async request => {
    const generation = fence.begin()
    const value = await request.promise
    if (fence.isCurrent(generation)) commits.push(value)
  }

  const pendingA = commitWhenLatest(requestA)
  const pendingB = commitWhenLatest(requestB)
  requestB.resolve('refresh-b')
  await pendingB
  requestA.resolve('refresh-a')
  await pendingA

  assert.deepEqual(commits, ['refresh-b'])
})

test('account refresh, selection and profile changes are wired through the scope fence', () => {
  const refresh = source.slice(source.indexOf('const refreshAccount'), source.indexOf('const source = useMemo'))
  const select = source.slice(source.indexOf('const useAccount'), source.indexOf('const requestFlow'))

  assert.match(refresh, /const scopeGeneration = scopeFenceRef\.current\.capture\(\)/)
  assert.match(refresh, /const refreshGeneration = accountRefreshFenceRef\.current\.begin\(\)/)
  assert.match(refresh, /const targetProfile = resolvedRoute\.route\.targetProfile \|\| resolvedRoute\.targetProfile/)
  assert.match(refresh, /profile: targetProfile/)
  assert.match(refresh, /!scopeFenceRef\.current\.isCurrent\(scopeGeneration\)/)
  assert.match(refresh, /!accountRefreshFenceRef\.current\.isCurrent\(refreshGeneration\)/)
  assert.match(refresh, /\[activeSessionId, connectionId, profile\]/)
  assert.match(select, /const scope = scopeFenceRef\.current\.capture\(\)/)
  assert.match(select, /!scopeFenceRef\.current\.isCurrent\(scope\)/)
  assert.match(select, /scopeFenceRef\.current\.isCurrent\(scope\)/)
  assert.match(source, /const activeSessionId = useValue\(host\.state\.activeSessionId\)/)
  assert.match(select, /session_id: activeSessionId/)
  assert.match(select, /profile: route\.targetProfile \|\| targetProfile/)
  assert.match(select, /pending_session_id === activeSessionId/)
  assert.match(select, /if \(result\?\.superseded\) return/)
  const selectionResult = select.indexOf("const result = await host.requestProfile(route, 'auth.accounts'")
  const preRefreshScopeGuard = select.indexOf(
    'if (!mountedRef.current || !scopeFenceRef.current.isCurrent(scope)) return',
    selectionResult
  )
  const postSelectionRefresh = select.indexOf('await refreshAccount()', selectionResult)
  assert.ok(selectionResult >= 0)
  assert.ok(preRefreshScopeGuard > selectionResult)
  assert.ok(postSelectionRefresh > preRefreshScopeGuard)
  assert.doesNotMatch(select, /host\.request\('auth\.accounts'/)
  assert.match(refresh, /host\.requestProfile\(\s*resolvedRoute\.route/)
  assert.doesNotMatch(refresh, /host\.request\('(account\.usage|auth\.accounts|auth\.cli\.accounts)'/)
  assert.match(source, /const matches = routes\.filter/)
  assert.match(source, /item\.profile === targetProfile/)
  assert.match(source, /matches\.length !== 1/)
  assert.doesNotMatch(source, /item\.targetProfile === targetProfile \|\|/)
  assert.match(source, /resourceRefreshFenceRef\.current\.begin\(\)/)
  assert.match(source, /accountRefreshFenceRef\.current\.invalidate\(\)/)
  assert.match(source, /resourceRefreshFenceRef\.current\.invalidate\(\)/)
})
