# Changelog

All notable changes to MyBrain are documented here.

## 1.0.3

- Update notifications: once connected, the plugin checks for new releases once a day via your MyBrain endpoint (and on demand via a "Check for updates" button in settings) and shows a notice with the release notes and update instructions. No files are changed automatically — updating still happens through BRAT or the Obsidian community-plugin updater.
- Updates can be skipped per version; skipping applies only to the current device and the reminder re-arms on the next release. Even for skipped versions, the settings tab keeps showing that an update is available.
- The plugin reports its installed version to MyBrain, so the web app can show an update notice for the connected vault.
- New `obsidian://mybrain/open` deep link opens the plugin's settings view — the MyBrain web app uses it to jump from the connector page straight into the plugin.
- Now requires Obsidian 1.8.7 or newer.

## 1.0.2

- Server-defined sync scope: the set of folders to sync is now driven by the server rather than only the client-side exclude list. Scope changes pushed over the WebSocket are applied live and trigger a re-sync, and scope is re-checked when a queued note flushes so a mid-edit scope change can't upload a now-excluded note.
- The plugin now sends the full vault folder tree alongside the manifest, so the connector can render a folder navigator server-side.
- Deep-link install now starts syncing immediately after settings are applied, instead of waiting for a server manifest request or the next reload.
- Settings tab shows live sync status, reflecting in real time whether a full-vault sync is currently uploading (overlapping syncs are tracked so the indicator doesn't flip to idle while one is still running).

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
