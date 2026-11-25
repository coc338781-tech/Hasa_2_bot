import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const patch = fs.readFileSync(new URL('../scripts/patch-baileys.js', import.meta.url), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Baileys rc14 mapping store reports only new or changed mappings', () => {
  assert.match(patch, /Signal', 'lid-mapping\.js/)
  assert.match(patch, /storeMutex = makeMutex/)
  assert.match(patch, /return Object\.entries\(pairMap\)\.map/)
  assert.match(patch, /serialize LID mapping updates and return newly mapped pairs/)
})

test('Baileys rc14 refreshes only new LIDs and validates known LIDs normally', () => {
  assert.match(patch, /const newLidUsers = new Set\(stored\.map\(p => p\.lidUser\)\)/)
  assert.match(patch, /assertSessions\(newLids, true\)/)
  assert.match(patch, /assertSessions\(knownLids\)/)
  assert.match(patch, /force-refresh only newly mapped LIDs/)
})

test('session patch preserves auth state and is version-gated', () => {
  assert.doesNotMatch(patch, /auth_info|rmSync|unlinkSync|rmdirSync/)
  assert.match(patch, /packageJson\.version !== '7\.0\.0-rc14'/)
})

test('session patch is idempotent for both Baileys modules', () => {
  assert.match(patch, /lidSource\.includes\(mappingMarker\)/)
  assert.match(patch, /sendSource\.includes\(sessionMarker\)/)
})

test('production validation applies Baileys patches before running tests', () => {
  assert.match(packageJson.scripts.check, /^node scripts\/patch-baileys\.js &&/)
  assert.match(packageJson.scripts.check, /npm run test:session-churn-patch/)
})
