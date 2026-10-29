// Minimal runtime stand-in for the `obsidian` module, which only exists inside
// the app. Classes are real so `instanceof` checks in src/ work against the
// in-memory vault in tests/vault.ts.

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  basename = "";
  extension = "";
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export const Platform = { isMobile: false };

export class Notice {
  constructor(public message: string) {}
}

export type FakeRequest = {
  url: string;
  method: string;
  body?: string | ArrayBuffer;
};

type FakeServer = (request: FakeRequest) => { status: number; json?: unknown };

let fakeServer: FakeServer | null = null;

/** Answer `requestUrl` calls in the current test (null: no network). */
export function setFakeServer(server: FakeServer | null): void {
  fakeServer = server;
}

export async function requestUrl(request: FakeRequest) {
  if (!fakeServer) throw new Error("requestUrl is not available in tests");

  const { status, json } = fakeServer(request);

  return { status, json, text: json === undefined ? "" : JSON.stringify(json) };
}

export class Plugin {
  constructor(
    public app: unknown,
    public manifest: { id: string; version: string },
  ) {}

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(): Promise<void> {}
}

export class PluginSettingTab {
  constructor(
    public app: unknown,
    public plugin: unknown,
  ) {}
}

export class Modal {
  constructor(public app: unknown) {}
}

// Settings UI, imported by src/settings.ts and never rendered in tests.
export class Setting {}
export class ButtonComponent {}
export class TextComponent {}
export class SettingDefinitionItem {}

export function debounce<A extends unknown[]>(fn: (...args: A) => void) {
  const debounced = (...args: A) => fn(...args);
  return Object.assign(debounced, { cancel: () => {} });
}

// Same contract as Obsidian's: strip `#heading` / `^block` from a link.
export function getLinkpath(linktext: string): string {
  const i = linktext.search(/[#^]/);
  return i === -1 ? linktext : linktext.slice(0, i);
}

// Same contract as Obsidian's getAllTags: frontmatter `tags`/`tag` (list or
// comma/space separated string) plus body tags, all with `#`; null when none.
export function getAllTags(cache: {
  frontmatter?: Record<string, unknown>;
  tags?: { tag: string }[];
}): string[] | null {
  const out: string[] = [];
  const fm = cache.frontmatter;

  for (const key of ["tags", "tag"]) {
    const value = fm?.[key];
    const items = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,\s]+/)
        : [];

    for (const item of items) {
      if (typeof item !== "string" || item.trim() === "") continue;
      const tag = item.trim();
      out.push(tag.startsWith("#") ? tag : `#${tag}`);
    }
  }

  for (const t of cache.tags ?? []) out.push(t.tag);

  return out.length > 0 ? out : null;
}
