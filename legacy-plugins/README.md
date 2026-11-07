# Legacy plugin source archive

These are the original plugin files copied from the previous HASA-MD_next-Bot repository so their code is preserved in this new project.

They are intentionally **not auto-loaded**. The old bot used a different plugin API and runtime (CommonJS plugins and a different Baileys wrapper/config shape). Loading them directly in Hasa_2_bot could break the new bot or expose unsafe command behavior. Each plugin must be reviewed and adapted into the new `plugins/` API before activation.

Preserved: anti-delete, auto-voice, autoreply, composing, fast-mode, Facebook downloader, hack, subbot.
