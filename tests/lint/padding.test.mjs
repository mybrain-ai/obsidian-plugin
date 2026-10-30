import assert from "node:assert/strict";
import { test } from "node:test";

import { createEslint } from "./eslint-instance.mjs";

const eslint = createEslint();
const RULE = "@stylistic/padding-line-between-statements";

test("a statement right after a const and before an if is reported", async () => {
  const found = await _padding(
    "export function f(): void {\n  const a = 1;\n  if (a) {\n    console.debug(a);\n  }\n}\n",
  );

  assert.ok(found.length > 0);
});

test("a blank line between statements passes", async () => {
  const found = await _padding(
    "export function f(): number {\n  const a = 1;\n  const b = 2;\n\n  if (a) {\n    console.debug(a);\n  }\n\n  return a + b;\n}\n",
  );

  assert.equal(found.length, 0);
});

async function _padding(code) {
  const [result] = await eslint.lintText(code, { filePath: "src/core/x.ts" });

  return result.messages.filter((m) => m.ruleId === RULE);
}
