import type { NativeNoteSettings } from "@/core/notes/types";
import type { ConfigReader } from "@/core/ports";

// Obsidian's own default when the Daily notes format field is left empty.
const DEFAULT_DAILY_NOTES_FORMAT = "YYYY-MM-DD";

const UNKNOWN: NativeNoteSettings = {
  templatesFolder: null,
  dailyNotesFolder: null,
  dailyNotesFormat: null,
};

/** Core Templates and Daily notes settings, read from their JSON files in the
 * config folder (there is no public API for them). Never throws. */
export async function readNativeNoteSettings(
  reader: ConfigReader,
  configDir: string,
): Promise<NativeNoteSettings> {
  const corePluginsPath = `${configDir}/core-plugins.json`;

  // No file yet means Obsidian's defaults (an empty map), and so does a failed
  // existence check; a file that can't be read means unknown.
  const corePlugins = (await _exists(reader, corePluginsPath))
    ? await _readJson(reader, corePluginsPath)
    : {};

  if (corePlugins === null) return { ...UNKNOWN };

  const out: NativeNoteSettings = { ...UNKNOWN };

  if (_isCorePluginEnabled(corePlugins, "templates")) {
    const templates = await _readJson(reader, `${configDir}/templates.json`);
    const folder = _normalizeFolder(_stringField(templates, "folder"));

    out.templatesFolder = folder === "" ? null : folder;
  }

  if (_isCorePluginEnabled(corePlugins, "daily-notes")) {
    const daily = await _readJson(reader, `${configDir}/daily-notes.json`);

    out.dailyNotesFolder = _normalizeFolder(_stringField(daily, "folder"));
    out.dailyNotesFormat =
      _stringField(daily, "format").trim() || DEFAULT_DAILY_NOTES_FORMAT;
  }

  return out;
}

async function _exists(reader: ConfigReader, path: string): Promise<boolean> {
  try {
    return await reader.exists(path);
  } catch {
    return false;
  }
}

async function _readJson(reader: ConfigReader, path: string): Promise<unknown> {
  try {
    if (!(await reader.exists(path))) return null;

    return JSON.parse(await reader.read(path)) as unknown;
  } catch {
    return null;
  }
}

/** `core-plugins.json` is an array of enabled ids up to Obsidian 1.4, a map
 * since. Templates and Daily notes default to on, so a missing entry means on. */
function _isCorePluginEnabled(corePlugins: unknown, id: string): boolean {
  if (Array.isArray(corePlugins)) return corePlugins.includes(id);

  if (corePlugins && typeof corePlugins === "object") {
    return (corePlugins as Record<string, unknown>)[id] !== false;
  }

  return false;
}

function _stringField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";

  const field = (value as Record<string, unknown>)[key];

  return typeof field === "string" ? field : "";
}

function _normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}
