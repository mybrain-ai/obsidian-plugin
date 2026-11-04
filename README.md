# mybrain.ai

This official plugin, maintained by the [mybrain.ai](https://mybrain.ai) team, connects your Obsidian vault to your MyBrain account. Your notes and the links between them sync automatically, and MyBrain turns them into knowledge sources you can search, chat with, and build on alongside everything else you know — so your second brain becomes a lasting personal asset instead of information that sits still in a folder.

![The MyBrain connectors page, where you connect Obsidian and other services](https://raw.githubusercontent.com/mybrain-ai/obsidian-plugin/main/docs/connectors.png)

> **Note:** A MyBrain account is required — the plugin does nothing without a bearer token issued by your account.

## Features

- **Automatic, continuous sync** — after the first sync, new notes, edits, renames, and deletes flow to MyBrain as you work. No manual exports.
- **Metadata first, text only when you include a note** — the plugin sends MyBrain the list of notes in the folders you choose (names, links, tags, word counts, and a few properties), so MyBrain can suggest which notes to bring in. The text of a note leaves your machine only after you include that note in MyBrain. See [What leaves your machine, and when](#what-leaves-your-machine-and-when).
- **Notes become queryable knowledge** — synced notes join your other sources in MyBrain's search, chat, and knowledge graph, so you can query, combine, and reuse what you already know.
- **Works on mobile** — runs on Obsidian Mobile, with attachment uploads off by default to protect cellular data.
- **Update notices, never auto-updates** — the plugin tells you when a new version exists but never changes files itself.
- **Transparent by design** — every request the plugin makes is documented under [What the plugin sends](#what-the-plugin-sends).

## Install

In Obsidian: **Settings → Community plugins → Browse** → search for "mybrain.ai" → Install → Enable.

The plugin's directory listing is at [community.obsidian.md/plugins/mybrain-ai](https://community.obsidian.md/plugins/mybrain-ai).

## Connect your vault

1. In the MyBrain web app, open the connectors page and connect **Obsidian**. A dialog appears with an **Open in Obsidian** button and, as a manual fallback, a bearer token (shown only once) with a **Copy** button.
2. Click **Open in Obsidian** — a confirmation inside Obsidian shows exactly which settings will change (token masked) before anything is written. Or paste the token manually into the **Bearer token** field in the plugin's settings tab.
3. Click **Test connection**.
4. The plugin sends the list of your notes right away. You can send it again any time with **Resync full vault**. New edits sync automatically.

## What leaves your machine, and when

Starting with version 1.1, the plugin works in two steps:

1. **The list of notes (metadata).** For every note in the folders you chose: its path and name, size, creation and modification times, a content hash, a word count, its tags, the notes it links to, the attachments it embeds, and only these properties: `tags`, `aliases`, `created`, `updated`, `date`, `source`, `url`, `private` and `kanban-plugin` (MyBrain uses the last two to hold notes marked `private: true` for your review and to skip Kanban boards). Any other property (for example a `diagnosis:` field) is left out of this list. The plugin also sends the folder tree and, when the core Templates and Daily notes plugins are on, their folders and date format, so MyBrain can tell templates and daily notes apart. The text of the notes is not sent.
2. **The text, only for notes you include.** When you include a note in MyBrain (one at a time, in bulk, or by approving a group), MyBrain asks the plugin for that note, and only then does the plugin send its full text, properties block included, plus the attachments it embeds. Notes you never include never have their text sent.

Choose folders in the MyBrain web app. The choice is pushed to the plugin and applied immediately, and nothing from folders outside it is sent. Until you choose, the list covers the whole vault.

If your MyBrain account is still on a server version that doesn't support this, the plugin falls back to the 1.0 behavior (it sends the text of every note in the chosen folders) and notes that in the developer console, so syncing never stops.

## Skip rules

- Files under the vault's config folder (`.obsidian` by default; respects a custom `configDir`) are always skipped.
- Non-`.md` files are skipped as standalone sources. Binary attachments are uploaded only when referenced from a note.
- Folders outside the sync scope you set in the MyBrain web app are skipped.

## Update notifications

Once connected, the plugin asks your MyBrain endpoint for the latest published release about once a day (and on demand via **Check for updates** in plugin settings). When a newer version exists, it shows a notice and a dialog with the release notes and update instructions. The plugin never installs updates itself — updating happens through Obsidian's community-plugin updater. Each new version can be skipped per device; a skipped version stays silent until the next release ships, but the **Plugin version** row in settings keeps showing that an update is available.

## Mobile

The plugin runs on Obsidian Mobile. Attachment uploads on cellular can be expensive, so they're off by default on mobile — you can enable them under **Sync attachments on mobile** in plugin settings.

## What the plugin sends

The plugin connects only to MyBrain's ingest endpoint. All traffic is over HTTPS / WSS to that single host. No other hosts are contacted from your machine, and no data is shared with third parties.

### HTTP endpoints

- **`POST /manifest`** — the list of notes in the chosen folders, with the metadata described in [What leaves your machine, and when](#what-leaves-your-machine-and-when), plus the folder tree. No note text. Sent on first connect, when the folder choice changes, when you click **Resync full vault**, and whenever the server asks for a refresh via the WebSocket below.
- **`POST /ingest`** — incremental vault changes, triggered (with a short debounce) by Obsidian's `create`/`modify`/`delete`/`rename` vault events. For a new or edited note: the same metadata as `/manifest`, no text. For a delete or rename: the path(s).
- **`POST /content`** — the text of the notes MyBrain asked for, in batches of up to 50, each with its content hash. Only notes inside the chosen folders are ever sent; a requested note that was deleted or is outside the chosen folders is reported back as missing, without text.
- **`POST /attachments`** — binary contents of attachment files embedded (`![[file.ext]]` or `![alt](path)`) in a note whose text was sent. Only sent when the server reports it doesn't already have a copy (content-hash deduplication).
- **`GET /ping`** — health check, sent when you click **Test connection** in plugin settings.
- **`GET /latest-release`** — the latest published plugin version and its release notes, used for [update notifications](#update-notifications). At most once a day, plus when you click **Check for updates**. MyBrain's servers source this from the plugin's GitHub releases — your machine never contacts GitHub.

### WebSocket

- **`wss://…/ws`** — a long-lived WebSocket the plugin opens after authenticating and keeps connected for the lifetime of the session. It auto-reconnects with exponential backoff and jitter if the connection drops. Its purpose is to let the server push messages at any time: a `manifest_request` prompts the plugin to re-send `POST /manifest` (e.g. after a server-side index rebuild), a sync-scope update changes which folders sync (see above), and a `content_requested` lists the notes you included, whose text the plugin then sends on `POST /content`. Each time it connects, the plugin sends one `hello` message with its protocol and version, so the server can re-send any request that was still open while the plugin was off. The connection authenticates by passing the bearer token as the `bearer.<token>` WebSocket subprotocol.

### Version reporting

Every request to your MyBrain endpoint carries two extra headers: `X-MyBrain-Plugin-Version` (the installed plugin version) and `X-MyBrain-Device-Id` (a random UUID generated per install and kept in device-local storage — it never syncs with your vault and never leaves your MyBrain endpoint). MyBrain uses them to show an update notice for your connected vault in the web app. How this data is handled is covered by the [MyBrain privacy policy](https://www.mybrain.ai/privacy).

## Privacy

Your data goes only between your Obsidian vault and MyBrain's ingest endpoint. What the plugin sends, and when, is described under [What leaves your machine, and when](#what-leaves-your-machine-and-when). The per-install id and plugin version described under [Version reporting](#version-reporting) are handled per the [MyBrain privacy policy](https://www.mybrain.ai/privacy). The bearer token is stored in plain text inside this vault's plugin data; avoid storing production tokens in synced or shared vaults, and rotate the token in the MyBrain web app if the vault is compromised. The plugin's source code is open at [github.com/mybrain-ai/obsidian-plugin](https://github.com/mybrain-ai/obsidian-plugin) for inspection.

## Development

To work on the plugin locally or test an unreleased version, sideload a development build:

1. Clone this repo and install dependencies:
   ```bash
   git clone https://github.com/mybrain-ai/obsidian-plugin.git
   cd obsidian-plugin
   npm install
   ```
2. Build:
   ```bash
   npm run build
   ```
   This produces `main.js` in the repo root; `manifest.json` and `styles.css` are already in the repo. The build bakes in the production ingest endpoint as the default — to develop against a local backend, connect through the deep link from your locally running web app, which stores the local endpoint in the plugin's settings (stored settings always beat the baked default).
3. Find your vault's plugin directory. On macOS, Obsidian's vault registry lives at `~/Library/Application Support/obsidian/obsidian.json` (`%APPDATA%\obsidian\obsidian.json` on Windows, `~/.config/obsidian/obsidian.json` on Linux). The plugin folder inside any vault is `<vault>/.obsidian/plugins/mybrain-ai/`.
4. Copy the three files into that folder, creating it if needed:
   ```bash
   mkdir -p "<vault>/.obsidian/plugins/mybrain-ai"
   cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/mybrain-ai/"
   ```
5. In Obsidian: **Settings → Community plugins**. If you see "Restricted mode," turn it off first. Then click **Reload plugins** (or restart Obsidian) and toggle **mybrain.ai** on under Installed plugins.
6. Continue with [Connect your vault](#connect-your-vault) above.

To iterate, re-run step 2 and copy the new `main.js` over; in Obsidian disable then re-enable the plugin (or use the "Hot reload" plugin) to pick up the change.

## Support

[mybrain.ai](https://mybrain.ai) · [Report an issue](https://github.com/mybrain-ai/obsidian-plugin/issues)

## License

MIT — see [LICENSE](./LICENSE).
