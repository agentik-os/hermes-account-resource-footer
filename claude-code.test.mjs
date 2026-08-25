import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')

test('Claude Code profiles use the dedicated CLI broker instead of Anthropic API auth', () => {
  const begin = source.slice(source.indexOf('const beginCliOauth'), source.indexOf('const submitOauth'))
  assert.match(begin, /'auth\.cli\.start'/)
  assert.match(begin, /provider: 'claude-code'/)
  assert.match(begin, /account_id: accountId/)
  assert.match(source, /'auth\.cli\.accounts'/)
  assert.match(source, /Connect Claude Code/)
  assert.match(source, /Connect Anthropic API/)
})

test('Claude Code status surfaces only connection and plan metadata', () => {
  const rows = source.slice(source.indexOf('function ClaudeCodeRows'), source.indexOf('function FooterControl'))
  assert.match(rows, /account\.loggedIn/)
  assert.match(rows, /account\.subscriptionType/)
  assert.match(rows, /Default Claude Code/)
  assert.doesNotMatch(rows, /email|orgId|token|credential/i)
})

test('CLI polling and submit stay route-pinned and preserve the modal on approval', () => {
  const submit = source.slice(source.indexOf('const submitOauth'), source.indexOf('const closeOauth'))
  const poll = source.slice(source.indexOf("const isCliFlow = oauthFlow?.kind === 'cli'", source.indexOf('useEffect(() => {', source.indexOf('const closeOauth'))), source.indexOf('mountedRef.current = true'))
  assert.match(submit, /'auth\.cli\.submit'/)
  assert.match(submit, /status: 'pending'/)
  assert.doesNotMatch(submit, /setOauthFlow\(null\)/)
  assert.match(poll, /'auth\.cli\.poll'/)
  assert.match(poll, /status: 'approved'/)
  assert.doesNotMatch(poll, /setOauthFlow\(null\)/)
})
