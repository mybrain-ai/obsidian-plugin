import assert from "node:assert/strict";
import { test } from "node:test";

import { createEslint } from "./eslint-instance.mjs";

const eslint = createEslint();

for (const specifier of ["electron", "lodash", "node:fs", "../infra/x"]) {
  test(`core importing "${specifier}" is rejected`, async () => {
    const found = await _restricted("src/core/x.ts", specifier);

    assert.equal(found.length, 1);
    assert.match(found[0].message, /core imports only @\/core/);
    assert.equal(found[0].severity, 2);
  });
}

test("core importing core passes the import restriction", async () => {
  assert.deepEqual(
    await _restricted("src/core/x.ts", "@/core/shared/hash"),
    [],
  );
});

const forbiddenInCoreTests = [
  ["obsidian", /without the Obsidian stub/],
  ["@/infra/obsidian/vault", /must not import infra, ui or main/],
  ["@/ui/notices", /must not import infra, ui or main/],
  ["@/main", /must not import infra, ui or main/],
  ["../stubs/obsidian", /without the Obsidian stub/],
  ["../support/vault", /without the Obsidian stub/],
  ["../support/fixture-vault", /without the Obsidian stub/],
  ["@test/stubs/obsidian", /without the Obsidian stub/],
  ["@test/support/vault", /without the Obsidian stub/],
  ["@test/support/fixture-vault", /without the Obsidian stub/],
];

for (const [specifier, message] of forbiddenInCoreTests) {
  test(`a core test importing "${specifier}" is rejected`, async () => {
    const found = await _restricted("tests/core/x.test.ts", specifier);

    assert.equal(found.length, 1);
    assert.match(found[0].message, message);
    assert.equal(found[0].severity, 2);
  });
}

test("a core test may import core and the port fakes", async () => {
  for (const specifier of [
    "@/core/sync/queue",
    "../support/fakes",
    "@test/support/fakes",
    "@test/support/types",
  ]) {
    assert.deepEqual(
      await _restricted("tests/core/x.test.ts", specifier),
      [],
      specifier,
    );
  }
});

async function _restricted(filePath, specifier) {
  const code = `import * as m from "${specifier}";\nexport const a = m;\n`;
  const [result] = await eslint.lintText(code, { filePath });

  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}
