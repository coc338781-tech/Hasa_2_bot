import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const patch = fs.readFileSync(new URL('../scripts/patch-baileys.js', import.meta.url), 'utf8')

test('retry uses the stanza PN when primary decrypt JID is LID', () => {
  assert.match(patch, /isLidUser\(decryptionJid\)[\s\S]*?participant_pn\s*\|\|\s*stanza\.attrs\.sender_pn\s*\|\|\s*stanza\.attrs\.peer_recipient_pn/)
})

test('retry uses the stanza LID when primary decrypt JID is PN', () => {
  assert.match(patch, /:\s*stanza\.attrs\.participant_lid\s*\|\|\s*stanza\.attrs\.sender_lid\s*\|\|\s*stanza\.attrs\.peer_recipient_lid/)
})

test('missing or duplicate alternate JID does not trigger a second decrypt', () => {
  assert.match(patch, /if \(!retryJid \|\| retryJid === decryptionJid\)\s*\{[\s\S]*?throw err/)
})

test('failed alternate decrypt preserves the original error', () => {
  assert.match(patch, /catch\s*\{\s*\/\/ Preserve the original failure[\s\S]*?throw err/)
})

test('patch refuses unexpected Baileys versions', () => {
  assert.match(patch, /packageJson\.version !== '7\.0\.0-rc14'/)
})

test('retry diagnostics are visible without logging private identifiers', () => {
  assert.match(patch, /console\.warn\('\[Hasa_2_bot\] Decrypt retry started using alternate PN\/LID identity\.'/)
  assert.match(patch, /console\.warn\('\[Hasa_2_bot\] Alternate PN\/LID decrypt retry succeeded\.'/)
  assert.match(patch, /console\.warn\('\[Hasa_2_bot\] Alternate PN\/LID decrypt retry failed\.'/)
  assert.doesNotMatch(patch, /logger\.debug\(\s*\{\s*key:\s*fullMessage\.key/)
})
