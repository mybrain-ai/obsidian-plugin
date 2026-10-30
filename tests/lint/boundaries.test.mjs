import assert from "node:assert/strict";
import { test } from "node:test";

import { createEslint } from "./eslint-instance.mjs";

const eslint = createEslint();

const cases = [
  [
    "src/core/x.ts",
    'import { request } from "@/infra/http/client";\nexport const a = request;\n',
    "core must not import infra",
  ],
  [
    "src/core/x.ts",
    'import { ObsidianNotifier } from "@/ui/notices";\nexport const a = ObsidianNotifier;\n',
    "core must not import ui",
  ],
  [
    "src/infra/a.ts",
    'import { confirm } from "@/ui/confirm-modal";\nexport const a = confirm;\n',
    "infra must not import ui",
  ],
  [
    "src/ui/a.ts",
    'import { request } from "@/infra/http/client";\nexport const a = request;\n',
    "ui must not import infra",
  ],
  [
    "src/ui/a.ts",
    'import { composeServices } from "@/main";\nexport const a = composeServices;\n',
    "only main.ts wires the layers",
  ],
  [
    "src/infra/a.ts",
    'import { composeServices } from "@/main";\nexport const a = composeServices;\n',
    "only main.ts wires the layers",
  ],
  [
    "src/core/x.ts",
    'import { composeServices } from "@/main";\nexport const a = composeServices;\n',
    "only main.ts wires the layers",
  ],
];

for (const [filePath, code, expected] of cases) {
  test(`${filePath} reports: ${expected}`, async () => {
    const found = await _lint(filePath, code);

    assert.equal(found.length, 1);
    assert.match(found[0].message, new RegExp(expected));
    assert.equal(found[0].severity, 2);
  });
}

test("core may import core", async () => {
  const found = await _lint(
    "src/core/x.ts",
    'import { sha256 } from "@/core/shared/hash";\nexport const a = sha256;\n',
  );

  assert.equal(found.length, 0);
});

test("main may import core, infra and ui", async () => {
  const code = [
    'import { sha256 } from "@/core/shared/hash";',
    'import { request } from "@/infra/http/client";',
    'import { confirm } from "@/ui/confirm-modal";',
    "export const a = [sha256, request, confirm];",
    "",
  ].join("\n");

  assert.equal((await _lint("src/main.ts", code)).length, 0);
});

test("a file outside every layer is reported", async () => {
  const [result] = await eslint.lintText("export const a = 1;\n", {
    filePath: "src/foo.ts",
  });
  const found = result.messages.filter(
    (m) => m.ruleId === "boundaries/no-unknown-files",
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 2);
});

test("main.ts is not reported as unknown", async () => {
  const [result] = await eslint.lintFiles(["src/main.ts"]);

  assert.equal(
    result.messages.filter((m) => m.ruleId === "boundaries/no-unknown-files")
      .length,
    0,
  );
});

test("core importing obsidian is rejected", async () => {
  const [result] = await eslint.lintText(
    'import { Notice } from "obsidian";\nexport const a = Notice;\n',
    { filePath: "src/core/x.ts" },
  );

  const found = result.messages.filter(
    (m) => m.ruleId === "no-restricted-imports",
  );

  assert.equal(found.length, 1);
  assert.match(found[0].message, /interface in core\/ports\.ts/);
});

async function _lint(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });

  return result.messages.filter((m) => m.ruleId === "boundaries/dependencies");
}
