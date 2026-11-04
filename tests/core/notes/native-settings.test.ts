import assert from "node:assert/strict";
import { test } from "node:test";

import { readNativeNoteSettings } from "@/core/notes/native-settings";
import type { ConfigReader } from "@/core/ports";

test("map format (Obsidian 1.4+), both plugins on", async () => {
  const out = await readNativeNoteSettings(
    _reader({
      ".obsidian/core-plugins.json": '{"templates": true, "daily-notes": true}',
      ".obsidian/templates.json": '{"folder": "/Modelos/"}',
      ".obsidian/daily-notes.json":
        '{"folder": "Diário", "format": "DD-MM-YYYY"}',
    }),
    ".obsidian",
  );

  assert.deepEqual(out, {
    templatesFolder: "Modelos",
    dailyNotesFolder: "Diário",
    dailyNotesFormat: "DD-MM-YYYY",
  });
});

test("array format (before 1.4) and Daily notes defaults", async () => {
  const out = await readNativeNoteSettings(
    _reader({
      ".obsidian/core-plugins.json": '["file-explorer", "daily-notes"]',
    }),
    ".obsidian",
  );

  assert.deepEqual(out, {
    templatesFolder: null,
    dailyNotesFolder: "",
    dailyNotesFormat: "YYYY-MM-DD",
  });
});

test("plugins off send null even when their settings files exist", async () => {
  const out = await readNativeNoteSettings(
    _reader({
      ".obsidian/core-plugins.json":
        '{"templates": false, "daily-notes": false}',
      ".obsidian/templates.json": '{"folder": "Modelos"}',
      ".obsidian/daily-notes.json": '{"folder": "Diário"}',
    }),
    ".obsidian",
  );

  assert.deepEqual(out, {
    templatesFolder: null,
    dailyNotesFolder: null,
    dailyNotesFormat: null,
  });
});

test("no core-plugins.json: Templates and Daily notes are on by default", async () => {
  const out = await readNativeNoteSettings(
    _reader({ ".obsidian/daily-notes.json": '{"folder": "Diário"}' }),
    ".obsidian",
  );

  assert.deepEqual(out, {
    templatesFolder: null,
    dailyNotesFolder: "Diário",
    dailyNotesFormat: "YYYY-MM-DD",
  });
});

test("map format without an entry for the plugin: its default (on)", async () => {
  const out = await readNativeNoteSettings(
    _reader({
      ".obsidian/core-plugins.json": '{"file-explorer": true}',
      ".obsidian/templates.json": '{"folder": "Modelos"}',
    }),
    ".obsidian",
  );

  assert.deepEqual(out, {
    templatesFolder: "Modelos",
    dailyNotesFolder: "",
    dailyNotesFormat: "YYYY-MM-DD",
  });
});

test("unreadable config never throws", async () => {
  const out = await readNativeNoteSettings(
    _reader({ ".config/core-plugins.json": "{not json" }),
    ".config",
  );

  assert.deepEqual(out, {
    templatesFolder: null,
    dailyNotesFolder: null,
    dailyNotesFormat: null,
  });
});

test("a reader that throws never throws", async () => {
  const throwing: ConfigReader = {
    exists: () => Promise.reject(new Error("boom")),
    read: () => Promise.reject(new Error("boom")),
  };

  assert.deepEqual(await readNativeNoteSettings(throwing, ".obsidian"), {
    templatesFolder: null,
    dailyNotesFolder: "",
    dailyNotesFormat: "YYYY-MM-DD",
  });
});

function _reader(config: Record<string, string>): ConfigReader {
  const files = new Map(Object.entries(config));

  return {
    exists: (path) => Promise.resolve(files.has(path)),
    read: (path) => Promise.resolve(files.get(path) ?? ""),
  };
}
