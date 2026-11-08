import fs from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Existing pairing compatibility patch: keep WEB_BROWSER pairing on WEB platform.
const platformFile = new URL('../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js', import.meta.url)
if (!fs.existsSync(platformFile)) {
  throw new Error('Baileys validate-connection.js not found; install dependencies first.')
}

let platformSource = fs.readFileSync(platformFile, 'utf8')
if (platformSource.includes('UserAgent.Platform.MACOS')) {
  platformSource = platformSource.replace('UserAgent.Platform.MACOS', 'UserAgent.Platform.WEB')
  fs.writeFileSync(platformFile, platformSource)
  console.log('Restored Baileys WEB platform for WEB_BROWSER pairing.')
} else if (platformSource.includes('UserAgent.Platform.WEB')) {
  console.log('Baileys WEB platform is already correct.')
} else {
  throw new Error('Baileys platform declaration was not recognized; no changes made.')
}

// Experimental rc14-only LID/PN alternate-address retry patch.
const require = createRequire(import.meta.url)
const entry = require.resolve('@whiskeysockets/baileys')
const libDir = dirname(entry)
const packageRoot = dirname(libDir)
const packageJson = JSON.parse(fs.readFileSync(join(packageRoot, 'package.json'), 'utf8'))

if (packageJson.version !== '7.0.0-rc14') {
  throw new Error(`Refusing to patch unexpected Baileys version: ${packageJson.version}`)
}

const decryptFile = join(libDir, 'Utils', 'decode-wa-message.js')
if (!fs.existsSync(decryptFile)) {
  throw new Error(`Baileys decrypt module not found: ${decryptFile}`)
}

let source = fs.readFileSync(decryptFile, 'utf8')
const marker = 'primary identity failed to decrypt; retrying with stanza-provided PN/LID pairing'

if (source.includes(marker)) {
  console.log('Baileys rc14 LID/PN decrypt retry patch already applied')
  process.exit(0)
}

const original = /case ['"]pkmsg['"]:\s*case ['"]msg['"]:\s*msgBuffer\s*=\s*await repository\.decryptMessage\(\{\s*jid:\s*decryptionJid,\s*type:\s*e2eType,\s*ciphertext:\s*content\s*\}\)\s*;?\s*break\s*;?/

const replacement = `case 'pkmsg':
case 'msg': {
  try {
    msgBuffer = await repository.decryptMessage({
      jid: decryptionJid,
      type: e2eType,
      ciphertext: content
    })
  } catch (err) {
    // Use the exact alternate identity WhatsApp paired with this stanza.
    // If PN was mapped to LID before decrypt, retry with the original author JID.
    const { senderAlt } = extractAddressingContext(stanza)
    const retryJid = decryptionJid !== author ? author : senderAlt
    if (!retryJid || retryJid === decryptionJid) {
      throw err
    }

    logger.debug(
      { key: fullMessage.key, primary: decryptionJid, retryWith: retryJid },
      'primary identity failed to decrypt; retrying with stanza-provided PN/LID pairing'
    )

    try {
      msgBuffer = await repository.decryptMessage({
        jid: retryJid,
        type: e2eType,
        ciphertext: content
      })
    } catch {
      // Preserve the original failure (for example, Bad MAC).
      throw err
    }
  }
  break
}`

if (!original.test(source)) {
  throw new Error('Could not find the expected Baileys rc14 decrypt block; no files changed')
}

source = source.replace(original, replacement)
fs.writeFileSync(decryptFile, source)
console.log('Applied isolated Baileys rc14 LID/PN decrypt retry patch')
