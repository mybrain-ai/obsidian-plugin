# Changelog

All notable changes to MyBrain are documented here.

## 1.0.1

- Removed the funding link from the plugin listing.

## 1.0.0

Initial release.

- Initial vault scan + real-time sync of markdown notes via `create`/`modify`/`delete`/`rename` events.
- Content-hash dedup on modify events: byte-identical writes (autosave, undo-redo back to the same state) are skipped client-side and never hit the network.
- Incremental catch-up on startup: any note whose disk mtime is newer than the last successful sync is re-enqueued, so edits made while the plugin was off (git pull, mobile sync, other vault sessions) are picked up automatically.
- Server-initiated manifest refresh over a long-lived WebSocket: the server can request a fresh full vault listing at any time, without the plugin polling.
- Bearer-token authentication against a MyBrain account.
- Settings tab: configurable ingest endpoint, exclude-folder list, "sync attachments on mobile" toggle, "test connection" probe, and "resync full vault" action.
- Wikilink and standard markdown-link extraction (raw targets persisted with each note; cross-note graph edges are server-side, future work).
- Attachment upload (images, PDFs, audio) via a content-hash deduplication protocol — the server only requests binaries it doesn't already have.
- Persisted retry queue with exponential backoff that survives Obsidian restarts.
- `obsidian://mybrain/install` deep-link handler for one-click token installation from the MyBrain web app, with a confirmation modal that previews exactly which settings will change (token shown masked) before anything is written.
- Desktop + mobile (mobile tested as compatible; full mobile QA coming in a future release).
