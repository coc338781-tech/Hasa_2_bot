import { installSessionLogRedaction } from './session-log-redaction.js'

// This module must be imported before Baileys so libsignal cannot emit
// SessionEntry diagnostics before the console methods are protected.
installSessionLogRedaction()
