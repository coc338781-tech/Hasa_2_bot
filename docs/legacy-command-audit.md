# Legacy command audit — HASA-MD_next-Bot → Hasa_2_bot

Audit source: `coc338781-tech/HASA-MD_next-Bot` branch `main` (the actual `index.js`, all eight legacy plugins, and the old 12-section `.list` menu).
Target: `coc338781-tech/Hasa_2_bot` feature branch `feat/restore-safe-legacy-commands`.

## Important finding

The old `.list` menu advertised roughly 190 command names, but the old source does **not** implement all of them. Direct handler inspection found only a small subset in `index.js` and the eight plugins. A menu entry is not proof that a command works. This audit therefore distinguishes working legacy functionality from menu-only labels; the latter must not be represented as completed or added as fake handlers.

## Legacy functionality already covered by the new bot

| Old functionality / commands | New bot coverage |
|---|---|
| Anti-delete event recovery | `plugins/anti-delete.js` (hardened; PR #11) |
| Auto voice and composing presence | `plugins/presence.js` |
| Auto-reply management: `addreply`, `replaceeply`, `replacereply`, `getreply`, `removereply`, `resetreply` | `plugins/autoreply.js` |
| Fast mode: `uptime`, `fastmode`, `loadavg` | `plugins/system.js` |
| Facebook URL download: `fb` | `plugins/downloader.js` (uses yt-dlp rather than the old third-party API) |
| Hack prank | `plugins/prank.js` |
| Subbot management: `subbot`, `subcheck`, `getsubbot`, `delsubbot`, `delallsubbot`, `restartsubbot`, `restartallsubbot`, `helpsubbot` | `plugins/subbot.js` and `lib/subbot-manager.js` |
| `ping`, `alive`, `system`, `ram`, `menu`, `list`, `settings/setting`, `apply/applyy` | `plugins/core.js` and `plugins/system.js`; the protected `.alive`, `.system`, and `.settings` handlers are not being redesigned in this work |
| `song`, `video` | `plugins/downloader.js` (search and URL input, file-size limits) |
| `sticker/s`, `toaudio` | `plugins/media-tools.js` |
| Group moderation and AI | `plugins/group.js` and `plugins/ai.js` |

## Safe utility commands restored in this feature branch

- `.math`, `.cal`, `.mathstep` — restricted arithmetic parser; no `eval`.
- `.id`, `.jid`, `.quote`, `.fancy`, `.wame`, `.readmore`.
- `.video`, `.song` search support and guarded downloads.
- `.dictionary` / `.dict` — English dictionary lookup.
- `.trt` — text translation; defaults to Sinhala, or accepts a target language code (for example `.trt ta Hello`).

## Old menu entries without a real old implementation

The old menu advertised these groups, but code inspection did not find working command handlers for these names in the old `index.js` or its eight plugins. They are not considered ported merely because they appeared in `.list`.

- **Convert:** `mp3tourl`, `dark`, `blur`, `toptt`, `remini`, `img2qr`, `removebg`, `toqr`, `subtr`, `splitmedia`, `surl`, `tts`, `img2url`, `toimg`, `pdf`, `emomix`, `removesticker`, `resetsticker`, `getsticker`, `addsticker`, `addbad`, `resetbad`, `getbad`, `resetvoice`, `removevoice`, `getvoice`, `addvoice`.
- **Owner / administration:** `update`, `getpp`, `enc`, `dec`, `boom`, `vv`, `tovv`, `send`, `deljid`, `dp`, `sendtag`, `sendmsg`, `remove`, `backup`, `restore`, `reset`, `note`, `myenv`, `dsn`, `report`, `quote`, `alljid`, `restart`, `join`, `about`, `theme`, `addseedr`, `addcmd`, `getcmd`, `delcmd`, `resetcmd`, `setup`, `tgauth`, `tgconfig`.
- **Main / utility:** `logo`, `edit`, `tempmail`, `rename`, `bingen`, `dictionary`, `readmore`, `device`, `newgroup`, `delgroup`, `save`, `block`, `unblock`, `help`, `id`, `jid`, `defaultimg`, `defaultfooter`.
- **Downloads:** `tgvideo`, `downurl`, `threads`, `twitter`, `pinterest`, `pastpaper`, `teradl`, `gitclone`, `tiktok`, `ig`, `apk`, `gdrive`, `mediafire`, `ss`, `seedr`, `anime`, `sisub`, `mega`, `movie`, `xvdl`, `tgup`.
- **Search / information:** `tiktoksearch`, `findtiktok`, `findapk`, `pixabay`, `unsplash`, `ip`, `cric`, `find`, `yts`, `npm`, `wabeta`, `movieinfo`, `weather`, `lyrics`, `git`.
- **Math / AI:** `mathstep`, `math`, `cal`, `imagine` (the old menu labels; new bot has the separate `ai` command).
- **Group / channel:** `gdp`, `automute`, `timer`, `gsetting`, `safemode`, `ingsettings`, `ban`, `unban`, `invite`, `mute`, `unmute`, `gdesc`, `gname`, `left`, `antispam`, `del`, `delopt`, `cinfo`, `cupd`, `creact`, `csong`, `ctiktok`.
- **Games:** `xo`, `delxo`, `guess`, `trivia`, `chess`, `hangman`, `scramble`, `slot`.
- **Sticker:** `attp`, `ttp`, `searchsticker`, `steal`.

## Intentionally excluded pending separate safety/design review

- Arbitrary code execution or environment/secret exposure: `eval`, `myenv`.
- Destructive or sensitive account/server/session actions: legacy reset/restore/backup, JID deletion, bulk messaging, and session-ID generation/transfer commands (including the legacy `.pair` flow), and in-chat package self-update commands (`.updatefb` / `.fbupdate`).
- Third-party API-dependent menu labels with no verified old implementation are not added as nonfunctional placeholders.

## Validation status

- Existing regression suites remain in `npm run check`.
- New dictionary/translation helper tests are included in `npm run check`.
- GitHub Actions must pass on the feature branch before this PR is considered ready.
- This branch/PR is not merged and no production deployment is performed as part of this audit.
