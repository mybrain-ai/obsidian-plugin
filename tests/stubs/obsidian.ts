// Minimal runtime stand-in for the `obsidian` module, which only exists inside
// the app. Classes are real so `instanceof` checks in src/ work against the
// in-memory vault in tests/support/vault.ts.
import type {
  ElementOptions,
  FakeRequest,
  FakeServer,
  StubManifest,
  TagCache,
} from "@test/support/types";

/** A file or folder of the vault, as Obsidian's class. */
export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

/** A vault file; tests/support/vault.ts fills the fields. */
export class TFile extends TAbstractFile {
  basename = "";
  extension = "";
  stat = { ctime: 0, mtime: 0, size: 0 };
}

/** A vault folder with its children. */
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

/** Desktop unless a test says otherwise. */
export const Platform = { isMobile: false };

/** Just enough of an Obsidian element for the UI code: children, text, the
 * `toggle` and `isConnected` state, and buttons to click. */
export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classes = new Set<string>();
  text = "";
  shown = true;
  isConnected = true;
  onClickHandler: (() => unknown) | undefined;

  constructor(
    readonly tag = "div",
    readonly cls = "",
  ) {}

  /** Append a `div`. */
  createDiv(options: ElementOptions = {}): FakeElement {
    return this._append("div", options);
  }

  /** Append a child element with optional text. */
  createEl(tag: string, options: ElementOptions = {}): FakeElement {
    return this._append(tag, options);
  }

  /** Append a `span`. */
  createSpan(options: ElementOptions = {}): FakeElement {
    return this._append("span", options);
  }

  /** Keep a click handler; other events are never fired in tests. */
  addEventListener(type: string, handler: () => unknown): void {
    if (type === "click") this.onClickHandler = handler;
  }

  /** Add a CSS class. */
  addClass(cls: string): void {
    this.classes.add(cls);
  }

  /** Add or remove a CSS class. */
  toggleClass(cls: string, on: boolean): void {
    if (on) this.classes.add(cls);
    else this.classes.delete(cls);
  }

  /** Replace the text. */
  setText(text: string): void {
    this.text = text;
  }

  /** Show or hide. */
  toggle(show: boolean): void {
    this.shown = show;
  }

  /** Every text in this element and below, in order. */
  texts(): string[] {
    return [this.text, ...this.children.flatMap((c) => c.texts())].filter(
      (t) => t !== "",
    );
  }

  /** The first button below this element with the label. */
  button(label: string): FakeElement | undefined {
    if (this.tag === "button" && this.text === label) return this;

    for (const child of this.children) {
      const found = child.button(label);

      if (found) return found;
    }

    return undefined;
  }

  /** Click it, as a user would. */
  click(): unknown {
    return this.onClickHandler?.();
  }

  private _append(tag: string, options: ElementOptions): FakeElement {
    const child = new FakeElement(tag, options.cls);

    child.text = options.text ?? "";
    this.children.push(child);

    return child;
  }
}

/** Records every notice; `containerEl.isConnected` turns false on `hide`. */
export class Notice {
  static readonly all: Notice[] = [];
  readonly containerEl = new FakeElement("notice");

  constructor(
    public message: string | FakeElement,
    public duration?: number,
  ) {
    Notice.all.push(this);
  }

  /** Take it off screen. */
  hide(): void {
    this.containerEl.isConnected = false;
  }
}

let _fakeServer: FakeServer | null = null;

/** Answer `requestUrl` calls in the current test (null: no network). */
export function setFakeServer(server: FakeServer | null): void {
  _fakeServer = server;
}

/** Obsidian's `requestUrl`, answered by the test's fake server. */
export async function requestUrl(request: FakeRequest) {
  if (!_fakeServer) throw new Error("requestUrl is not available in tests");

  const { status, json } = await _fakeServer(request);

  return { status, json, text: json === undefined ? "" : JSON.stringify(json) };
}

/** Registration calls are no-ops here; tests reach the registered handlers
 * through the vault and workspace fakes instead. */
export class Plugin {
  /* eslint-disable @typescript-eslint/naming-convention -- Obsidian's own names */
  declare _loaded: boolean;
  declare _events: unknown[];
  declare _children: unknown[];
  /* eslint-enable @typescript-eslint/naming-convention -- back to the rule */

  constructor(
    public app: unknown,
    public manifest: StubManifest,
  ) {
    // Obsidian's `Component` assigns these in its constructor, so a plugin
    // member of the same name breaks loading; the stub assigns them the same way.
    this._loaded = false;
    this._events = [];
    this._children = [];
  }

  /** No `data.json` yet; tests replace this. */
  async loadData(): Promise<unknown> {
    return null;
  }

  /** Writes nowhere; tests replace this. */
  async saveData(): Promise<void> {}

  /** No-op: tests render the tab themselves. */
  addSettingTab(): void {}

  /** No-op: the vault fake keeps its own handlers. */
  registerEvent(): void {}

  /** Returns the id; intervals never fire in tests. */
  registerInterval(id: number): number {
    return id;
  }

  /** No-op: deep-link tests register through their own fake. */
  registerObsidianProtocolHandler(): void {}
}

/** The tab's redraw is a no-op here; tests replace it to see it called. */
export class PluginSettingTab {
  constructor(
    public app: unknown,
    public plugin: unknown,
  ) {}

  /** Redraw the tab from the setting definitions. */
  update(): void {}
}

/** Opening renders at once; every opened modal is kept in `all`. */
export class Modal {
  static readonly all: Modal[] = [];
  readonly titleEl = new FakeElement("title");
  readonly contentEl = new FakeElement("content");

  constructor(public app: unknown) {}

  /** Render through `onOpen`. */
  open(): void {
    Modal.all.push(this);
    this.onOpen();
  }

  /** Close through `onClose`. */
  close(): void {
    this.onClose();
  }

  /** Overridden by each modal. */
  onOpen(): void {}

  /** Overridden by each modal. */
  onClose(): void {}
}

/** A settings row: its element, description, text field and buttons. */
export class Setting {
  readonly settingEl = new FakeElement("setting");
  readonly controlEl = new FakeElement("control");
  desc: string | FakeElement = "";
  text: TextComponent | undefined;

  /** Add a text field inside the row; it is kept as `text`. */
  addText(build: (text: TextComponent) => unknown): this {
    this.text = new TextComponent();
    build(this.text);

    return this;
  }

  /** Replace the description. */
  setDesc(desc: string | FakeElement): this {
    this.desc = desc;

    return this;
  }

  /** Add a button inside the row. */
  addButton(build: (button: ButtonComponent) => unknown): this {
    build(new ButtonComponent(this.settingEl));

    return this;
  }
}

/** A button appended to its container, clickable through `FakeElement`. */
export class ButtonComponent {
  readonly buttonEl: FakeElement;
  disabled = false;

  constructor(container: FakeElement) {
    this.buttonEl = container.createEl("button");
  }

  /** Set the label. */
  setButtonText(text: string): this {
    this.buttonEl.text = text;

    return this;
  }

  /** Mark it as the main action. */
  setCta(): this {
    return this;
  }

  /** Enable or disable it. */
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;

    return this;
  }

  /** Run `handler` on click. */
  onClick(handler: () => unknown): this {
    this.buttonEl.onClickHandler = handler;

    return this;
  }
}

/** A text field holding its value; `type` acts out typing in it. */
export class TextComponent {
  readonly inputEl = new FakeElement("input");
  value = "";
  private _onChange: ((value: string) => unknown) | undefined;

  /** Set the placeholder; not shown in tests. */
  setPlaceholder(): this {
    return this;
  }

  /** Set the value. */
  setValue(value: string): this {
    this.value = value;

    return this;
  }

  /** The value. */
  getValue(): string {
    return this.value;
  }

  /** Run `handler` on every change. */
  onChange(handler: (value: string) => unknown): this {
    this._onChange = handler;

    return this;
  }

  /** Type a new value, as a user would. */
  type(value: string): void {
    this.value = value;
    this._onChange?.(value);
  }
}

/** Only its type is used; the class exists so the import resolves. */
export class SettingDefinitionItem {}

/** Same contract as Obsidian's, on `window` timers, so a test decides when
 * the call fires and can see that `cancel` drops it. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  timeout = 0,
) {
  let pending: number | undefined;

  const cancel = () => {
    if (pending !== undefined) window.clearTimeout(pending);

    pending = undefined;
  };

  const debounced = (...args: A) => {
    cancel();
    pending = window.setTimeout(() => {
      pending = undefined;
      fn(...args);
    }, timeout);
  };

  return Object.assign(debounced, { cancel });
}

/** Same contract as Obsidian's: strip `#heading` / `^block` from a link. */
export function getLinkpath(linktext: string): string {
  const i = linktext.search(/[#^]/);

  return i === -1 ? linktext : linktext.slice(0, i);
}

/** Same contract as Obsidian's getAllTags: frontmatter `tags`/`tag` (list or
 * comma/space separated string) plus body tags, all with `#`; null when none. */
export function getAllTags(cache: TagCache): string[] | null {
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

// Obsidian puts `createFragment` on the global object; the UI code calls it.
(globalThis as Record<string, unknown>).createFragment = (
  build?: (fragment: FakeElement) => void,
) => {
  const fragment = new FakeElement("fragment");

  build?.(fragment);

  return fragment;
};
