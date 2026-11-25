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
const decryptMarker = 'Decrypt retry started using alternate PN/LID identity.'
const legacyDecryptMarker = 'primary identity failed to decrypt; retrying with stanza-provided PN/LID pairing'

if (decryptSource.includes(decryptMarker) || decryptSource.includes(legacyDecryptMarker)) {
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
      // Preserve the original failure (for example, Bad MAC).
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

// Apply the upstream Baileys LID session fix: only force-refresh sessions for
// newly created or changed PN↔LID mappings. Known LIDs use normal validation.
const lidFile = join(libDir, 'Signal', 'lid-mapping.js')
if (!fs.existsSync(lidFile)) {
  throw new Error(`Baileys LID mapping module not found: ${lidFile}`)
}

let lidSource = fs.readFileSync(lidFile, 'utf8')
const mappingMarker = 'Hasa_2_bot: serialize LID mapping updates and return newly mapped pairs'
if (lidSource.includes(mappingMarker)) {
  console.log('Baileys rc14 LID mapping concurrency patch already applied.')
} else {
  const mutexImport = "import { makeMutex } from '../Utils/make-mutex.js';"
  if (!lidSource.includes(mutexImport)) {
    const importAnchor = "import { LRUCache } from 'lru-cache';"
    if (!lidSource.includes(importAnchor)) {
      throw new Error('Could not find the Baileys LID mapping import anchor; no LID mapping patch applied')
    }
    lidSource = lidSource.replace(importAnchor, importAnchor + '\n' + mutexImport)
  }

  const constructorAnchor = '        this.logger = logger;\n    }'
  if (!lidSource.includes('this.storeMutex = makeMutex();')) {
    if (!lidSource.includes(constructorAnchor)) {
      throw new Error('Could not find the Baileys LID mapping constructor anchor; no LID mapping patch applied')
    }
    lidSource = lidSource.replace(
      constructorAnchor,
      '        this.logger = logger;\n        this.storeMutex = makeMutex();\n    }'
    )
  }

  const methodStart = lidSource.indexOf('    async storeLIDPNMappings(pairs) {')
  const methodEnd = lidSource.indexOf('    async getLIDForPN(pn) {', methodStart)
  if (methodStart < 0 || methodEnd < 0) {
    throw new Error('Could not locate the Baileys storeLIDPNMappings method; no LID mapping patch applied')
  }

  const method = `    async storeLIDPNMappings(pairs) {
        // ${mappingMarker}
        if (pairs.length === 0)
            return [];
        const validatedPairs = [];
        for (const { lid, pn } of pairs) {
            if (!((isLidUser(lid) && isPnUser(pn)) || (isPnUser(lid) && isLidUser(pn)))) {
                this.logger.warn('Invalid LID-PN mapping: ' + lid + ', ' + pn);
                continue;
            }
            const lidDecoded = jidDecode(lid);
            const pnDecoded = jidDecode(pn);
            if (!lidDecoded || !pnDecoded)
                continue;
            validatedPairs.push({ pnUser: pnDecoded.user, lidUser: lidDecoded.user });
        }
        if (validatedPairs.length === 0)
            return [];
        if (validatedPairs.every(({ pnUser, lidUser }) => this.mappingCache.get('pn:' + pnUser) === lidUser)) {
            return [];
        }
        return this.storeMutex.mutex(async () => {
            const cacheMissSet = new Set();
            const existingMappings = new Map();
            for (const { pnUser } of validatedPairs) {
                const cached = this.mappingCache.get('pn:' + pnUser);
                if (cached) {
                    existingMappings.set(pnUser, cached);
                }
                else {
                    cacheMissSet.add(pnUser);
                }
            }
            if (cacheMissSet.size > 0) {
                const cacheMisses = [...cacheMissSet];
                this.logger.trace('Batch fetching ' + cacheMisses.length + ' LID mappings from database');
                const stored = await this.keys.get('lid-mapping', cacheMisses);
                for (const pnUser of cacheMisses) {
                    const existingLidUser = stored[pnUser];
                    if (existingLidUser) {
                        existingMappings.set(pnUser, existingLidUser);
                        this.mappingCache.set('pn:' + pnUser, existingLidUser);
                        this.mappingCache.set('lid:' + existingLidUser, pnUser);
                    }
                }
            }
            const pairMap = {};
            for (const { pnUser, lidUser } of validatedPairs) {
                const existingLidUser = existingMappings.get(pnUser);
                if (existingLidUser === lidUser) {
                    this.logger.debug({ pnUser, lidUser }, 'LID mapping already exists, skipping');
                    continue;
                }
                pairMap[pnUser] = lidUser;
            }
            if (Object.keys(pairMap).length === 0)
                return [];
            this.logger.trace({ pairMap }, 'Storing ' + Object.keys(pairMap).length + ' pn mappings');
            const batchData = {};
            for (const [pnUser, lidUser] of Object.entries(pairMap)) {
                batchData[pnUser] = lidUser;
                batchData[lidUser + '_reverse'] = pnUser;
            }
            await this.keys.transaction(async () => {
                await this.keys.set({ 'lid-mapping': batchData });
            }, 'lid-mapping');
            for (const [pnUser, lidUser] of Object.entries(pairMap)) {
                this.mappingCache.set('pn:' + pnUser, lidUser);
                this.mappingCache.set('lid:' + lidUser, pnUser);
            }
            return Object.entries(pairMap).map(([pnUser, lidUser]) => ({ pnUser, lidUser }));
        });
    }
`

  lidSource = lidSource.slice(0, methodStart) + method + lidSource.slice(methodEnd)
  fs.writeFileSync(lidFile, lidSource)
  console.log('Applied Baileys rc14 LID mapping concurrency patch.')
}

let sendSource = fs.readFileSync(sendFile, 'utf8')
const sessionMarker = 'const newLidUsers = new Set(stored.map(p => p.lidUser))'
if (sendSource.includes(sessionMarker)) {
  console.log('Baileys rc14 new-LID-only session refresh patch already applied.')
} else {
  const callStart = sendSource.indexOf('                await signalRepository.lidMapping.storeLIDPNMappings(')
  const extractedMarker = '            const extracted = extractDeviceJids'
  const callEnd = sendSource.indexOf(extractedMarker, callStart)
  if (callStart < 0 || callEnd < 0) {
    throw new Error('Could not locate the Baileys device LID mapping/session assertion block; no send patch applied')
  }

  const newBlock = `                const stored = await signalRepository.lidMapping.storeLIDPNMappings(lidResults.map(a => ({ lid: a.lid, pn: a.id })));
                // Hasa_2_bot: force-refresh only newly mapped LIDs; validate known LIDs normally.
                ${sessionMarker};
                const isNewlyMapped = lid => newLidUsers.has(jidDecode(lid)?.user ?? '');
                const lids = lidResults.map(a => a.lid);
                const newLids = lids.filter(isNewlyMapped);
                const knownLids = lids.filter(lid => !isNewlyMapped(lid));
                if (newLids.length) {
                    try {
                        await assertSessions(newLids, true);
                    }
                    catch (err) {
                        logger.warn({ err, count: newLids.length }, 'failed to assert sessions for newly mapped LIDs');
                    }
                }
                if (knownLids.length) {
                    try {
                        await assertSessions(knownLids);
                    }
                    catch (err) {
                        logger.warn({ err, count: knownLids.length }, 'failed to assert sessions for known LIDs');
                    }
                }
`
  sendSource = sendSource.slice(0, callStart) + newBlock + sendSource.slice(callEnd)
  fs.writeFileSync(sendFile, sendSource)
  console.log('Applied Baileys rc14 new-LID-only session refresh patch.')
}
