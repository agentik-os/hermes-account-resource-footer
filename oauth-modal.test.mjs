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
  assert.match(source, /const expectsPastedCode = Boolean\(oauthFlow\?\.flow === 'pkce'\)/)
  assert.match(source, /if \(!oauthFlow \|\| oauthFlow\.flow !== 'pkce' \|\| !oauthCode\.trim\(\)\) return/)
  assert.match(source, /void submitOauth\(\)/)
})
