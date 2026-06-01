# MyBrain

Syncs your Obsidian vault to your MyBrain account so notes are searchable alongside your other knowledge sources.

## Install

### Community plugins (when approved)

In Obsidian: **Settings → Community plugins → Browse** → search for "MyBrain" → Install → Enable.

### Beta via BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).
2. In BRAT: **Add Beta plugin** → `mybrain-ai/obsidian-plugin`.
3. Enable **MyBrain** in **Settings → Community plugins → Installed plugins**.

### Sideload (manual install / development build)

Use this when you're working on the plugin locally or testing an unreleased version.

1. Clone this repo and install dependencies:
   ```bash
   git clone https://github.com/mybrain-ai/obsidian-plugin.git
   cd obsidian-plugin
   npm install
   ```
2. Build, baking in the ingest endpoint you want the plugin to default to. See [`.env.example`](./.env.example) for the build-time variables; the build fails fast if `MYBRAIN_API_BASE` is unset. Use the dev backend URL when working locally:
   ```bash
   MYBRAIN_API_BASE=http://localhost:8000/integrations/obsidian npm run build
   ```
   (Or `cp .env.example .env`, edit it, then `set -a && source .env && set +a && npm run build`.) This produces `main.js` in the repo root. `manifest.json` and `styles.css` are already in the repo.
3. Find your vault's plugin directory. On macOS, Obsidian's vault registry lives at `~/Library/Application Support/obsidian/obsidian.json` (`%APPDATA%\obsidian\obsidian.json` on Windows, `~/.config/obsidian/obsidian.json` on Linux). The plugin folder inside any vault is `<vault>/.obsidian/plugins/mybrain/`.
4. Copy the three files into that folder, creating it if needed:
   ```bash
   mkdir -p "<vault>/.obsidian/plugins/mybrain"
   cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/mybrain/"
   ```
5. In Obsidian: **Settings → Community plugins**. If you see "Restricted mode," turn it off first. Then click **Reload plugins** (or restart Obsidian) and toggle **MyBrain** on under Installed plugins.
6. Continue with [Configure](#configure) below.

To iterate, re-run step 2 and copy the new `main.js` over; in Obsidian disable then re-enable the plugin (or use the "Hot reload" plugin) to pick up the change.

## Configure

1. In the MyBrain web app, go to **Settings → Connected Apps → MyBrain Sync (Obsidian)** and click **Connect Obsidian**. A dialog appears with two fields, each with a **Copy** button: a bearer token (shown only once) and an endpoint URL.
2. In Obsidian, open the **MyBrain** plugin settings tab.
3. Paste the bearer token into the **Token** field and the endpoint URL into the **Endpoint** field.
4. Click **Test connection**.
5. Click **Resync full vault** to send your existing notes. New edits sync automatically.

## What the plugin sends

The plugin connects to the ingest endpoint you configure (default `https://api.mybrain.ai/integrations/obsidian`). All traffic is over HTTPS / WSS to that single host. No telemetry. No third-party services.

### HTTP endpoints

- **`POST /manifest`** — the full vault listing: for every markdown file, the relative path, basename, content, frontmatter, modification time, size, and SHA-256 content hash. Sent on first connect (initial vault scan) and whenever the server asks for a refresh via the WebSocket below.
- **`POST /ingest`** — incremental vault deltas. For each changed file: the same fields as `/manifest`, plus extracted wikilink and standard-markdown-link targets, plus references (hash + path) to any non-markdown files the note embeds. Triggered (with a short debounce) by Obsidian's `create`/`modify`/`delete`/`rename` vault events.
- **`POST /attachments`** — binary contents of attachment files referenced by `![[file.ext]]` or `![alt](path)` in notes. Only sent when the server reports it doesn't already have a copy (content-hash deduplication).
- **`GET /ping`** — health check, sent when you click **Test connection** in plugin settings.

### WebSocket

- **`wss://…/ws`** — a long-lived WebSocket the plugin opens after authenticating and keeps connected for the lifetime of the session. It auto-reconnects with exponential backoff and jitter if the connection drops. Its only purpose is to let the server send a `manifest_request` message at any time, which prompts the plugin to re-send `POST /manifest` (e.g. after a server-side index rebuild). The connection authenticates by passing the bearer token as the `bearer.<token>` WebSocket subprotocol.

## Selecting which notes are active in MyBrain

Receiving notes is not the same as using them. After the plugin syncs your vault, the MyBrain web app gives you a per-file selector: pick which notes to extract knowledge from. Unselected notes stay in your account (so toggling them back on is instant) but are excluded from anything MyBrain reasons over.

You effectively have two filters that compose:

- **Plugin-side `Exclude folders`** (runs first, on your machine) — any folder you list here is never sent to MyBrain at all.
- **MyBrain-side selector** (runs after, in the web app) — of the notes that did get sent, picks which ones are actually used in search / chat / the knowledge graph.

## Skip rules

- Files under the vault's config folder (`.obsidian` by default; respects a custom `configDir`) are always skipped.
- Non-`.md` files are skipped as standalone sources. Binary attachments are uploaded only when referenced from a note.
- Folders listed under **Exclude folders** in the plugin settings are skipped.

## Mobile

The plugin runs on Obsidian Mobile. Attachment uploads on cellular can be expensive, so they're off by default on mobile — you can enable them under **Sync attachments on mobile** in plugin settings.

## Privacy

Your data goes only between your Obsidian vault and the ingest endpoint you configure. The bearer token is stored in plain text inside this vault's plugin data; avoid storing production tokens in synced or shared vaults, and rotate the token in the MyBrain web app if the vault is compromised. The plugin's source code is open at [github.com/mybrain-ai/obsidian-plugin](https://github.com/mybrain-ai/obsidian-plugin) for inspection.

## Support

[mybrain.ai](https://mybrain.ai) · [Report an issue](https://github.com/mybrain-ai/obsidian-plugin/issues)

## License

MIT — see [LICENSE](./LICENSE).
