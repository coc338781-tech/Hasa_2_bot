import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const patch = fs.readFileSync(new URL('../scripts/patch-baileys.js', import.meta.url), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Baileys rc14 patch targets the ordinary LID session refresh', () => {
  assert.match(patch, /Socket', 'messages-send\.js/)
  assert.ok(patch.includes(String.raw`const forceRefresh = /await assertSessions\(lids,\s*true\)/g`))
  assert.match(patch, /await assertSessions\(lids\)/)
})

test('session patch removes force refresh without deleting or resetting auth state', () => {
  assert.match(patch, /do not force-refresh already mapped LID sessions/)
  assert.doesNotMatch(patch, /auth_info|rmSync|unlinkSync|rmdirSync/)
})

test('session patch is version-gated and idempotent', () => {
  assert.match(patch, /packageJson\.version !== '7\.0\.0-rc14'/)
  assert.match(patch, /if \(sendSource\.includes\(sessionMarker\)\)/)
  assert.match(patch, /matches\.length !== 1/)
})

test('production validation applies Baileys patches before running tests', () => {
  assert.match(packageJson.scripts.check, /^node scripts\/patch-baileys\.js &&/)
  assert.match(packageJson.scripts.check, /npm run test:session-churn-patch/)
})
