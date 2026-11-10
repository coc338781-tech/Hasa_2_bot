import test from 'node:test'
import assert from 'node:assert/strict'
import { installSessionLogRedaction } from '../lib/session-log-redaction.js'

function makeConsole() {
  const calls = []
  const target = {}
  for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
    target[method] = (...args) => calls.push({ method, args })
  }
  return { target, calls }
}

test('sensitive SessionEntry objects are suppressed without exposing key values', () => {
  const { target, calls } = makeConsole()
  class SessionEntry {
    constructor() {
      this.privKey = 'DO_NOT_LEAK_PRIVATE_KEY'
      this.rootKey = 'DO_NOT_LEAK_ROOT_KEY'
    }
  }

  assert.equal(installSessionLogRedaction(target), true)
  target.log('Closing session:', new SessionEntry())

  assert.equal(calls.length, 1)
  assert.match(calls[0].args[0], /Suppressed sensitive libsignal session-state diagnostic/)
  assert.doesNotMatch(JSON.stringify(calls), /DO_NOT_LEAK/)
})

test('raw SessionEntry dumps containing key fields are suppressed', () => {
  const { target, calls } = makeConsole()
  installSessionLogRedaction(target)
  target.error('SessionEntry { currentRatchet: { privKey: <Buffer SECRET> } }')

  assert.equal(calls.length, 1)
  assert.match(calls[0].args[0], /Suppressed sensitive/)
  assert.doesNotMatch(JSON.stringify(calls), /SECRET/)
})

test('ordinary application logs remain unchanged', () => {
  const { target, calls } = makeConsole()
  installSessionLogRedaction(target)
  target.info('Hasa_2_bot connected')
  assert.deepEqual(calls, [{ method: 'info', args: ['Hasa_2_bot connected'] }])
})

test('installation is idempotent', () => {
  const { target } = makeConsole()
  assert.equal(installSessionLogRedaction(target), true)
  assert.equal(installSessionLogRedaction(target), false)
})
