import assert from "node:assert/strict";
import { test } from "node:test";
import { readNativeNoteSettings } from "@/native-settings";

function reader(files: Record<string, string>) {
  return {
    exists: async (p: string) => p in files,
    read: async (p: string) => files[p],
  };
}

test("map format (Obsidian 1.4+), both plugins on", async () => {
  const out = await readNativeNoteSettings(
    reader({
      ".obsidian/core-plugins.json": '{"templates": true, "daily-notes": true}',
      ".obsidian/templates.json": '{"folder": "/Modelos/"}',
      ".obsidian/daily-notes.json": '{"folder": "Diário", "format": "DD-MM-YYYY"}',
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
    reader({
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
    reader({
      ".obsidian/core-plugins.json": '{"templates": false, "daily-notes": false}',
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

test("unreadable config never throws", async () => {
  const out = await readNativeNoteSettings(
    reader({ ".config/core-plugins.json": "{not json" }),
    ".config",
  );

  assert.deepEqual(out, {
    templatesFolder: null,
    dailyNotesFolder: null,
    dailyNotesFormat: null,
  });
});
