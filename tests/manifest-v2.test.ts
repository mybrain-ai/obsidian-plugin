import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { test } from "node:test";
import { collectManifestV2 } from "@/vault-metadata";
import {
  createFixtureVault,
  DAILY,
  DIARY,
  KANBAN,
  MOC,
  PDF,
  PRIVATE,
  TEMPLATE,
  VAULT_ENVELOPE,
} from "./fixture-vault";
import { createVault } from "./vault";

const FIXTURE = "tests/fixtures/obsidian/manifest_v2.json";

async function fixtureManifest() {
  const vault = createFixtureVault();
  const files = [MOC, DIARY, DAILY, TEMPLATE, PRIVATE, KANBAN].map((p) =>
    vault.file(p),
  );
  return await collectManifestV2(vault.app, files, VAULT_ENVELOPE);
}

test("manifest v2 matches the contract fixture byte for byte", async () => {
  const body = await fixtureManifest();
  const json = `${JSON.stringify(body, null, 2)}\n`;

  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(FIXTURE, json);

  assert.equal(json, readFileSync(FIXTURE, "utf8"));
});

test("manifest v2 never carries note text", async () => {
  const body = await fixtureManifest();
  const json = JSON.stringify(body);

  assert.equal(body.protocol, 2);
  for (const file of body.files) assert.equal("content" in file, false);
  assert.equal(json.includes("Mapa da pesquisa"), false);
  assert.equal(json.includes("cinco perguntas"), false);
});

test("links resolve (display-alias form included); missing targets go to unresolved", async () => {
  const moc = (await fixtureManifest()).files.find((f) => f.path === MOC);

  assert.ok(moc);
  assert.deepEqual(moc.links, [DIARY, PDF]);
  assert.deepEqual(moc.unresolved, ["Entrevista 12"]);
  assert.deepEqual(moc.embeds, [PDF]);
  assert.deepEqual(
    moc.attachments.map((a) => a.path),
    [PDF],
  );
});

test("body and frontmatter tags come together, without #", async () => {
  const moc = (await fixtureManifest()).files.find((f) => f.path === MOC);

  assert.deepEqual(moc?.tags, ["pesquisa", "pesquisa/metodo"]);
});

test("only allowed frontmatter keys leave the vault", async () => {
  const body = await fixtureManifest();
  const moc = body.files.find((f) => f.path === MOC);

  assert.deepEqual(moc?.frontmatter, {
    tags: ["pesquisa"],
    aliases: ["Pesquisa MOC"],
    created: "2026-03-02",
  });
  assert.equal(JSON.stringify(body).includes("diagnostico"), false);
  assert.equal(JSON.stringify(body).includes("confidencial"), false);
});

test("the properties the server's triage reads (private, kanban-plugin) leave the vault", async () => {
  const body = await fixtureManifest();
  const privateNote = body.files.find((f) => f.path === PRIVATE);
  const board = body.files.find((f) => f.path === KANBAN);

  assert.deepEqual(privateNote?.frontmatter, { private: true });
  assert.deepEqual(board?.frontmatter, { "kanban-plugin": "basic" });
});

test("words exclude the frontmatter; notes without allowed keys send null", async () => {
  const body = await fixtureManifest();
  const daily = body.files.find((f) => f.path === DAILY);
  const diary = body.files.find((f) => f.path === DIARY);

  assert.equal(daily?.words, 5);
  assert.equal(daily?.frontmatter, null);
  assert.equal(diary?.words, 8);
});

test("templates and daily notes settings come from the core plugins", async () => {
  const body = await fixtureManifest();

  assert.equal(body.templatesFolder, "Templates");
  assert.equal(body.dailyNotesFolder, "Diário");
  assert.equal(body.dailyNotesFormat, "YYYY-MM-DD");
});

test("an embed of the note's own section (![[#heading]]) is not an embed of another file", async () => {
  const vault = createVault({
    notes: [
      {
        path: "Notes/Long.md",
        content: "# Part\n\n![[#Part]]\n",
        ctime: 1,
        mtime: 2,
        embeds: ["#Part"],
      },
    ],
  });
  const cache = vault.app.metadataCache;
  // Worst case: an empty link path resolving to the note it is written in.
  cache.getFirstLinkpathDest = (linkpath, source) =>
    linkpath === "" ? vault.file(source) : null;

  const body = await collectManifestV2(
    vault.app,
    [vault.file("Notes/Long.md")],
    VAULT_ENVELOPE,
  );

  assert.deepEqual(body.files[0].embeds, []);
  assert.deepEqual(body.files[0].attachments, []);
});

test("an embed with a subpath (#page, #heading) still lists its attachment", async () => {
  const vault = createVault({
    notes: [
      {
        path: "Notes/Report.md",
        content: "See ![[slides.pdf#page=2]]\n",
        ctime: 1,
        mtime: 2,
        embeds: ["slides.pdf#page=2"],
      },
    ],
    binaries: [
      {
        path: "Files/slides.pdf",
        bytes: new Uint8Array([1, 2, 3]),
        ctime: 1,
        mtime: 2,
      },
    ],
  });

  const body = await collectManifestV2(
    vault.app,
    [vault.file("Notes/Report.md")],
    VAULT_ENVELOPE,
  );
  const [note] = body.files;

  assert.deepEqual(note.embeds, ["Files/slides.pdf"]);
  assert.deepEqual(
    note.attachments.map((a) => a.path),
    ["Files/slides.pdf"],
  );
});
