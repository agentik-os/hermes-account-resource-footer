import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

test('every account card renders its own redacted quota snapshot', () => {
  const quota = source.slice(source.indexOf('function AccountQuota'), source.indexOf('function AccountRows'))
  const rows = source.slice(source.indexOf('function AccountRows'), source.indexOf('function FooterControl'))

  assert.match(quota, /usage\?\.windows/)
  assert.match(quota, /used_percent/)
  assert.match(quota, /remaining_percent/)
  assert.match(quota, /% used · \$\{remaining/)
  assert.match(rows, /jsx\(AccountQuota, \{ usage: account\.usage \}\)/)
  assert.match(rows, /account\.usage\?\.plan/)
})

test('quota rows keep unique React keys when window labels repeat', () => {
  const quota = source.slice(source.indexOf('function AccountQuota'), source.indexOf('function AccountRows'))

  assert.match(quota, /windows\.map\(\(window, index\) =>/)
  assert.match(quota, /`\$\{window\.label \|\| String\(window\.reset_at \|\| used\)\}:\$\{index\}`/)
  assert.doesNotMatch(quota, /}, window\.label \|\| String\(window\.reset_at \|\| used\)\)/)
})

test('quota state is visible without selecting an account', () => {
  const rows = source.slice(source.indexOf('function AccountRows'), source.indexOf('function FooterControl'))
  const selectCall = rows.indexOf('onClick: () => onUse')
  const quotaRender = rows.indexOf('jsx(AccountQuota')

  assert.ok(selectCall >= 0)
  assert.ok(quotaRender >= 0)
  assert.match(source, /Checking quota…/)
  assert.match(source, /Quota unavailable/)
})

test('account selection buttons are disabled while a switch is in flight', () => {
  const rows = source.slice(source.indexOf('function AccountRows'), source.indexOf('function ClaudeCodeRows'))

  assert.match(rows, /function AccountRows\(\{ accountsByProvider, onUse, busy \}\)/)
  assert.match(rows, /disabled: busy/)
  assert.match(source, /jsx\(AccountRows, \{ accountsByProvider, onUse: useAccount, busy \}\)/)
})

test('account cards distinguish the gateway-active credential from durable preference', () => {
  const rows = source.slice(source.indexOf('function AccountRows'), source.indexOf('function ClaudeCodeRows'))
  const refresh = source.slice(source.indexOf('const refreshAccount'), source.indexOf('const source = useMemo'))

  assert.match(rows, /account\.active \? 'ACTIVE' : account\.preferred \? 'PREFERRED' : 'USE'/)
  assert.match(rows, /border: account\.active/)
  assert.match(refresh, /session_id: activeSessionId/)
  assert.match(source, /\[activeSessionId, connectionId, profile\]/)
})

test('registration does not recreate obsolete titlebar fallbacks', () => {
  const registration = source.slice(source.indexOf('export default'))

  assert.match(registration, /ctx\.register\(\{ id: 'footer', area: STATUSBAR_AREAS\.right/)
  assert.doesNotMatch(source, /terminal-titlebar|theme-mode-titlebar|titleBar\.tools\.right/)
  assert.doesNotMatch(source, /function toggleTerminal|function toggleThemeMode/)
})
