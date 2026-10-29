import type { NativeNoteSettings } from "@/types";

type ConfigReader = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
};

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

  // No file yet means Obsidian's defaults (an empty map); a file that can't
  // be read means unknown.
  const corePlugins = (await exists(reader, corePluginsPath))
    ? await readJson(reader, corePluginsPath)
    : {};

  if (corePlugins === null) return { ...UNKNOWN };

  const out: NativeNoteSettings = { ...UNKNOWN };

  if (isCorePluginEnabled(corePlugins, "templates")) {
    const templates = await readJson(reader, `${configDir}/templates.json`);
    const folder = normalizeFolder(stringField(templates, "folder"));

    out.templatesFolder = folder === "" ? null : folder;
  }

  if (isCorePluginEnabled(corePlugins, "daily-notes")) {
    const daily = await readJson(reader, `${configDir}/daily-notes.json`);

    out.dailyNotesFolder = normalizeFolder(stringField(daily, "folder"));
    out.dailyNotesFormat =
      stringField(daily, "format").trim() || DEFAULT_DAILY_NOTES_FORMAT;
  }

  return out;
}

// `core-plugins.json` was an array of enabled ids up to Obsidian 1.4 and is a
// map of id -> enabled since then. Templates and Daily notes are on by default
// (`defaultOn` in Obsidian), so a map without their entry means on.
function isCorePluginEnabled(corePlugins: unknown, id: string): boolean {
  if (Array.isArray(corePlugins)) return corePlugins.includes(id);

  if (corePlugins && typeof corePlugins === "object") {
    return (corePlugins as Record<string, unknown>)[id] !== false;
  }

  return false;
}

async function exists(reader: ConfigReader, path: string): Promise<boolean> {
  try {
    return await reader.exists(path);
  } catch {
    return false;
  }
}

async function readJson(reader: ConfigReader, path: string): Promise<unknown> {
  try {
    if (!(await reader.exists(path))) return null;

    return JSON.parse(await reader.read(path)) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";

  const field = (value as Record<string, unknown>)[key];

  return typeof field === "string" ? field : "";
}

function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}
