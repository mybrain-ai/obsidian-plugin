# Changelog

All notable changes to MyBrain are documented here.

## 1.2.0

- Attachments that fail to upload are retried automatically, also after Obsidian restarts. If they keep failing or MyBrain refuses one, a notice and a row in the plugin settings let you retry them.
- **Test connection** shows "unexpected server reply" when the server answers with an empty body, instead of a JavaScript error message.
- A damaged edit queue in the plugin's saved data no longer stops the plugin from loading. The queue starts empty; notes edited since the last sync are sent again at startup, but deletes and renames that were waiting in it are lost.
- The "token rejected" notice shows once, even when several requests find the token rejected at the same time.
- A token the server rejects during the update check is now treated like any other rejected token: the "token rejected" notice shows and syncing pauses until you paste a new one.
- Pasting and saving a new token resumes syncing right away, instead of waiting for the next full sync.
- Disabling the plugin right after changing the token or endpoint no longer reopens the server connection.
- When the token, a setting or the settings from an install link can't be saved, a notice says so and the change is undone, so the plugin keeps using what is saved. A **Resync full vault** that can't be saved is undone the same way.
- A sync that went through is no longer reported as failed when only saving its result fails.
- Sync notices no longer point to the developer console: a failed sync suggests **Resync full vault**, and the count of notes that couldn't be read stands on its own.

## 1.1.0

- Metadata first, text on request (sync protocol 2). The first sync, edits, and **Resync full vault** now send only the list of notes in the folders you chose: path, name, size, creation and modification times, content hash, word count, tags (from the note body and its properties), resolved links, links to notes that don't exist yet, embeds, and attachment references. The text of a note, and the attachments it embeds, go only when MyBrain asks for that note, which happens when you include it. Opening the install link from the web app now sends that list, not the text of the whole vault.
- Only these properties leave your vault: `tags`, `aliases`, `created`, `updated`, `date`, `source`, `url`. Any other frontmatter key stays on your machine.
- Links are now resolved in Obsidian (aliases included) before they're sent, and they come with every sync, not only with edits.
- The plugin reads the folder and date format of the core Templates and Daily notes plugins, when they are on, so MyBrain can tell templates and daily notes apart.
- MyBrain can ask for a note's text over the WebSocket (`content_requested`); the plugin answers in batches of 50 on `POST /content`, never for notes outside the chosen folders. On every (re)connect the plugin says hello so requests left open while it was off are sent again.
- Older MyBrain servers keep working: if the server doesn't accept the new protocol, the plugin falls back to the 1.0 behavior and logs it in the developer console.
- README: describes what leaves your machine and when, and links to the privacy policy at www.mybrain.ai/privacy.
- An embed that points at part of a file (`![[report.pdf#page=2]]`) now sends that file as an attachment too.

## 1.0.6

- MyBrain is now listed in the [Obsidian community-plugin directory](https://community.obsidian.md/plugins/mybrain-ai) — install and update it directly from **Settings → Community plugins**, no beta-install tooling needed.
- The update dialog and install docs now point exclusively at the community-plugin directory.

## 1.0.5

- Settings now appear in Obsidian's settings search (adopts the declarative settings API). No visible changes to the settings tab itself.
- Release assets (`main.js`, `styles.css`) now ship with GitHub artifact attestations, so their provenance can be cryptographically verified against this repository.
- Timers now run through the window object for popout-window compatibility, per Obsidian's plugin guidelines.
- Now requires Obsidian 1.13.0 or newer; users on older Obsidian keep 1.0.4.

## 1.0.4

- Renamed the plugin to **mybrain.ai** (id `mybrain-ai`) — the previous id and name are used by an unrelated plugin in the Obsidian community directory. Deep links (`obsidian://mybrain/...`) are unchanged.
- Existing manual or BRAT installs live in `.obsidian/plugins/mybrain/` and won't pick up this release; reinstall under the new id to keep receiving updates. Plugin settings need to be re-entered (or copy `data.json` from the old folder to the new one).

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
