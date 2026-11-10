const SECRET_FIELD_PATTERN = /(?:privKey|rootKey|remoteIdentityKey|identityKeyPair|chainKey|messageKeys)\\s*:/i
const SESSION_ENTRY_PATTERN = /SessionEntry\\s*\\{/i
const INSTALLED = Symbol.for('hasa.sessionLogRedaction.installed')

/**
 * Prevent libsignal's diagnostic SessionEntry objects from writing ratchet
 * private-key material to PM2/stdout logs. Ordinary application logs pass
 * through unchanged. Install this before importing Baileys.
 */
export function installSessionLogRedaction(targetConsole = console) {
  if (!targetConsole || targetConsole[INSTALLED]) return false

  for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
    const original = targetConsole[method]
    if (typeof original !== 'function') continue

    targetConsole[method] = function (...args) {
      const text = args.filter(value => typeof value === 'string').join(' ')
      const hasSessionObject = args.some(value =>
        value && typeof value === 'object' &&
        (value.constructor?.name === 'SessionEntry' ||
          Object.keys(value).some(key => /^(?:privKey|rootKey|remoteIdentityKey|identityKeyPair|chainKey|messageKeys)$/.test(key)))
      )
      const sensitiveDump = hasSessionObject ||
        SESSION_ENTRY_PATTERN.test(text) ||
        SECRET_FIELD_PATTERN.test(text) ||
        /Closing session:\\s*$/i.test(text)

      if (sensitiveDump) {
        return original.call(this, '[Hasa_2_bot] Suppressed sensitive libsignal session-state diagnostic.')
      }

      return original.apply(this, args)
    }
  }

  Object.defineProperty(targetConsole, INSTALLED, { value: true })
  return true
}
