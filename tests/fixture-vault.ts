// The vault behind tests/fixtures/obsidian/*.json (a small research vault, plus
// the cases the protocol must get right: a link with a display alias (the form
// Obsidian autocomplete writes for an alias; a bare [[alias]] stays
// unresolved in Obsidian too), a link to a missing note,
// a PDF embed, a body tag next to frontmatter tags, a property outside the
// allowed list, and the `private` and `kanban-plugin` properties the server's
// triage reads).
import { createVault, type TestVault } from "./vault";

export const MOC = "02 Áreas/Pesquisa/MOC Pesquisa.md";
export const DIARY = "02 Áreas/Pesquisa/Diary study - roteiro.md";
export const DAILY = "Diário/2026-10-28.md";
export const TEMPLATE = "Templates/Reunião.md";
export const PDF = "Anexos/relatorio-atlas-2025.pdf";
export const PRIVATE = "Projetos/Salário.md";
export const KANBAN = "Projetos/Quadro.md";

export const MOC_CONTENT = [
  "---",
  "tags: [pesquisa]",
  "aliases: [Pesquisa MOC]",
  "created: 2026-03-02",
  "diagnostico: confidencial",
  "---",
  "# MOC Pesquisa",
  "",
  "Mapa da pesquisa de método. Ver [[Diary study - roteiro|Diary study]] e [[Entrevista 12]].",
  "",
  "#pesquisa/metodo",
  "",
  "![[relatorio-atlas-2025.pdf]]",
  "",
].join("\n");

export const DIARY_CONTENT = [
  "---",
  "aliases: [Diary study]",
  "---",
  "Roteiro do diary study com cinco perguntas abertas.",
  "",
].join("\n");

export const DAILY_CONTENT = "Dia curto. Nada a registrar.\n";

export const TEMPLATE_CONTENT = "## Pauta\n\n- {{date}}\n";

export const PRIVATE_CONTENT = [
  "---",
  "private: true",
  "---",
  "Salário, contas fixas e a reserva do mês. O aluguel vence no dia cinco,",
  "a escola no dia dez e o cartão no dia quinze. O que sobra vai para a",
  "reserva de emergência, até completar seis meses de despesas.",
  "",
].join("\n");

export const KANBAN_CONTENT = [
  "---",
  "kanban-plugin: basic",
  "---",
  "## A fazer",
  "",
  "- [ ] Revisar o roteiro",
  "",
].join("\n");

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 fixture");

export const VAULT_ENVELOPE = {
  vaultId: "11111111-2222-4333-8444-555555555555",
  vaultName: "Test vault",
  clientTime: "2026-10-28T15:00:00.000Z",
  pluginVersion: "1.1.0",
};

export function createFixtureVault(): TestVault {
  return createVault({
    notes: [
      {
        path: MOC,
        content: MOC_CONTENT,
        ctime: 1761000000000,
        mtime: 1761600000000,
        frontmatter: {
          tags: ["pesquisa"],
          aliases: ["Pesquisa MOC"],
          created: "2026-03-02",
          diagnostico: "confidencial",
        },
        bodyTags: ["#pesquisa/metodo"],
        embeds: ["relatorio-atlas-2025.pdf"],
        // Obsidian counts embeds as links too.
        resolvedLinks: { [DIARY]: 1, [PDF]: 1 },
        unresolvedLinks: { "Entrevista 12": 1 },
      },
      {
        path: DIARY,
        content: DIARY_CONTENT,
        ctime: 1761000000000,
        mtime: 1761100000000,
        frontmatter: { aliases: ["Diary study"] },
      },
      {
        path: DAILY,
        content: DAILY_CONTENT,
        ctime: 1761650000000,
        mtime: 1761650000000,
      },
      {
        path: TEMPLATE,
        content: TEMPLATE_CONTENT,
        ctime: 1760000000000,
        mtime: 1760000000000,
      },
      {
        path: PRIVATE,
        content: PRIVATE_CONTENT,
        ctime: 1761200000000,
        mtime: 1761200000000,
        frontmatter: { private: true },
      },
      {
        path: KANBAN,
        content: KANBAN_CONTENT,
        ctime: 1761300000000,
        mtime: 1761300000000,
        frontmatter: { "kanban-plugin": "basic" },
      },
    ],
    binaries: [
      {
        path: PDF,
        bytes: PDF_BYTES,
        ctime: 1761000000000,
        mtime: 1761000000000,
      },
    ],
    config: {
      ".obsidian/core-plugins.json": JSON.stringify({
        "file-explorer": true,
        templates: true,
        "daily-notes": true,
      }),
      ".obsidian/templates.json": JSON.stringify({ folder: "Templates" }),
      ".obsidian/daily-notes.json": JSON.stringify({
        folder: "Diário",
        format: "YYYY-MM-DD",
        template: "Templates/Diária",
      }),
    },
  });
}
