import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

test('authorization starts in a persistent fixed modal and does not auto-open the browser', () => {
  const begin = source.slice(source.indexOf('const beginOauth'), source.indexOf('const submitOauth'))
  assert.doesNotMatch(begin, /openExternal/)
  assert.match(source, /const oauthModal = oauthFlow/)
  assert.match(source, /position: 'fixed', inset: 0/)
  assert.match(source, /'aria-label': 'Close authorization'/)
  assert.match(source, /children: \[jsxs\(Popover,[\s\S]*\), oauthModal\]/)
})

test('modal supports both device-code and website-to-terminal code directions', () => {
  assert.match(source, /oauthFlow\.user_code/)
  assert.match(source, /Code to enter in the website/)
  assert.match(source, /Authorization code from the website/)
  assert.match(source, /oauthFlow\?\.flow === 'pkce'/)
  assert.match(source, /oauthFlow\?\.kind === 'cli' && oauthFlow\?\.expects_code/)
  assert.match(source, /!oauthCode\.trim\(\)\) return/)
  assert.match(source, /void submitOauth\(\)/)
})

test('authorization state can only be cleared by an explicit close action', () => {
  const clears = [...source.matchAll(/setOauthFlow\(null\)/g)]
  assert.equal(clears.length, 1)

  const submit = source.slice(source.indexOf('const submitOauth'), source.indexOf('const closeOauth'))
  assert.match(submit, /status: 'approved'/)
  assert.doesNotMatch(submit, /setOauthFlow\(null\)/)
  assert.doesNotMatch(submit, /setOauthCode\(''\)/)

  const polling = source.slice(source.indexOf("oauthFlow\.flow !== 'device_code'"), source.indexOf("mountedRef\.current = true"))
  assert.match(polling, /status: 'approved'/)
  assert.doesNotMatch(polling, /setOauthFlow\(null\)/)

  const close = source.slice(source.indexOf('const closeOauth'), source.indexOf("window.addEventListener('keydown'"))
  assert.match(close, /setOauthFlow\(null\)/)
  assert.match(close, /busyGeneration\.current \+= 1/)
  assert.match(close, /setBusy\(false\)/)
  assert.match(source, /let retainedOauthFlow = null/)
  assert.match(source, /useState\(\(\) => retainedOauthFlow\)/)
})

test('opening the authorization page is state-neutral and contains the click', () => {
  const open = source.slice(source.indexOf('const openOauthUrl'), source.indexOf('const pasteOauthCode'))
  assert.match(open, /preventDefault/)
  assert.match(open, /stopPropagation/)
  assert.match(open, /openExternal\(url\)/)
  assert.doesNotMatch(open, /setOauthFlow|setOauthCode/)
  assert.match(source, /onPointerDown: event => event\.stopPropagation\(\)/)
})

test('scope changes keep submit and poll pinned without refreshing or notifying the new view', () => {
  const scopeMatcher = source.slice(source.indexOf('const flowMatchesCurrentScope'), source.indexOf('const resolveActiveRoute'))
  assert.match(scopeMatcher, /host\.state\.connectionId\.get\(\)/)
  assert.match(scopeMatcher, /host\.state\.profile\.get\(\)/)
  assert.match(scopeMatcher, /flow\.connectionId === currentConnection/)
  assert.match(scopeMatcher, /flow\.routeProfile === currentProfile/)

  const submit = source.slice(source.indexOf('const submitOauth'), source.indexOf('const closeOauth'))
  assert.match(submit, /requestFlow\(\s*activeFlow,/)
  assert.match(submit, /const matchesCurrentScope = flowMatchesCurrentScope\(activeFlow\)/)
  assert.match(submit, /if \(!matchesCurrentScope\) return\s*await refreshAccount\(\)/)
  assert.match(submit, /!flowMatchesCurrentScope\(activeFlow\)[\s\S]*host\.notify\(\{ kind: 'success'/)
  assert.match(submit, /!mountedRef\.current/)
  assert.match(submit, /!scopeFenceRef\.current\.isCurrent\(scope\)/)

  const polling = source.slice(source.indexOf("oauthFlow.flow !== 'device_code'"), source.indexOf('mountedRef.current = true'))
  assert.match(polling, /requestFlow\(\s*activeFlow,/)
  assert.match(polling, /const matchesCurrentScope = flowMatchesCurrentScope\(activeFlow\)/)
  assert.match(polling, /if \(!matchesCurrentScope\) return\s*await refreshAccount\(\)/)
  assert.match(polling, /!flowMatchesCurrentScope\(activeFlow\)[\s\S]*host\.notify\(\{ kind: 'success'/)
  assert.match(polling, /!mountedRef\.current/)
  assert.match(polling, /!scopeFenceRef\.current\.isCurrent\(scope\)/)

  assert.match(source, /const oauthScopeChanged = Boolean\(oauthFlow && !flowMatchesCurrentScope\(oauthFlow\)\)/)
  assert.match(source, /role: 'status'/)
  assert.match(source, /Authorization remains pinned to/)
  assert.match(source, /Switch back to refresh that account view\./)
})
