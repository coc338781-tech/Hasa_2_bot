import fs from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Keep WEB_BROWSER pairing on the WEB platform.
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

const require = createRequire(import.meta.url)
const entry = require.resolve('@whiskeysockets/baileys')
const libDir = dirname(entry)
const packageRoot = dirname(libDir)
const packageJson = JSON.parse(fs.readFileSync(join(packageRoot, 'package.json'), 'utf8'))

if (packageJson.version !== '7.0.0-rc14') {
  throw new Error(`Refusing to patch unexpected Baileys version: ${packageJson.version}`)
}

// Fix LID/PN address mismatch on incoming encrypted messages.
const decryptFile = join(libDir, 'Utils', 'decode-wa-message.js')
if (!fs.existsSync(decryptFile)) {
  throw new Error(`Baileys decrypt module not found: ${decryptFile}`)
}

let decryptSource = fs.readFileSync(decryptFile, 'utf8')
const decryptMarker = 'primary identity failed to decrypt; retrying with stanza-provided PN/LID pairing'

if (decryptSource.includes(decryptMarker)) {
  console.log('Baileys rc14 LID/PN decrypt retry patch already applied.')
} else {
  const originalDecrypt = /case ['"]pkmsg['"]:\s*case ['"]msg['"]:\s*msgBuffer\s*=\s*await repository\.decryptMessage\(\{\s*jid:\s*decryptionJid,\s*type:\s*e2eType,\s*ciphertext:\s*content\s*\}\)\s*;?\s*break\s*;?/

  const replacementDecrypt = `case 'pkmsg':
case 'msg': {
  try {
    msgBuffer = await repository.decryptMessage({
      jid: decryptionJid,
      type: e2eType,
      ciphertext: content
    })
  } catch (err) {
    const retryJid = isLidUser(decryptionJid)
      ? stanza.attrs.participant_pn || stanza.attrs.sender_pn || stanza.attrs.peer_recipient_pn
      : stanza.attrs.participant_lid || stanza.attrs.sender_lid || stanza.attrs.peer_recipient_lid
    if (!retryJid || retryJid === decryptionJid) {
      throw err
    }

    console.warn('[Hasa_2_bot] Decrypt retry started using alternate PN/LID identity.')
    try {
      msgBuffer = await repository.decryptMessage({
        jid: retryJid,
        type: e2eType,
        ciphertext: content
      })
      console.warn('[Hasa_2_bot] Alternate PN/LID decrypt retry succeeded.')
    } catch {
      console.warn('[Hasa_2_bot] Alternate PN/LID decrypt retry failed.')
      throw err
    }
  }
  break
}`

  if (!originalDecrypt.test(decryptSource)) {
    throw new Error('Could not find the expected Baileys rc14 decrypt block; no files changed')
  }

  decryptSource = decryptSource.replace(originalDecrypt, replacementDecrypt)
  fs.writeFileSync(decryptFile, decryptSource)
  console.log('Applied isolated Baileys rc14 LID/PN decrypt retry patch.')
}

// Stop Baileys rc14 from force-recreating every known contact's Signal session
// during ordinary device lookups. New/missing sessions still pass validateSession
// and are created normally; only the unnecessary force=true refresh is removed.
const sendFile = join(libDir, 'Socket', 'messages-send.js')
if (!fs.existsSync(sendFile)) {
  throw new Error(`Baileys send module not found: ${sendFile}`)
}

let sendSource = fs.readFileSync(sendFile, 'utf8')
const sessionMarker = 'Hasa_2_bot: do not force-refresh already mapped LID sessions'
if (sendSource.includes(sessionMarker)) {
  console.log('Baileys rc14 LID session-refresh guard already applied.')
} else {
  const forceRefresh = /await assertSessions\\(lids,\\s*true\\)/g
  const matches = [...sendSource.matchAll(forceRefresh)]
  if (matches.length !== 1) {
    throw new Error('Could not find exactly one expected Baileys rc14 forced LID session refresh; no session patch applied')
  }
  sendSource = sendSource.replace(
    forceRefresh,
    `// ${sessionMarker}\n\t\t\t\t\tawait assertSessions(lids)`
  )
  fs.writeFileSync(sendFile, sendSource)
  console.log('Applied Baileys rc14 LID session-refresh guard.')
}
