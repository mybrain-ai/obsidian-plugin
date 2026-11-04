import assert from "node:assert/strict";
import { test } from "node:test";

import { createEslint } from "./eslint-instance.mjs";

const eslint = createEslint();
const NAMING = "@typescript-eslint/naming-convention";

test("a type declared in a logic file is rejected", async () => {
  for (const code of [
    "export type A = { a: number };\n",
    "export interface A {\n  a: number;\n}\n",
    "export enum A {\n  B = 1,\n}\n",
  ]) {
    const found = await _reports("src/core/x.ts", code, "no-restricted-syntax");

    assert.equal(found.length, 1, code);
    assert.match(found[0].message, /types\.ts \(or ports\.ts \/ errors\.ts\)/);
    assert.equal(found[0].severity, 2);
  }
});

test("a test file may not declare types either", async () => {
  const found = await _reports(
    "tests/core/x.ts",
    "export type A = { a: number };\n",
    "no-restricted-syntax",
  );

  assert.equal(found.length, 1);
});

test("types, ports and errors files may declare types", async () => {
  for (const file of ["types", "ports", "errors"]) {
    const found = await _reports(
      `src/core/${file}.ts`,
      "export type A = { a: number };\nexport interface B {\n  b: number;\n}\n",
      "no-restricted-syntax",
    );

    assert.deepEqual(found, [], file);
  }
});

test("an exported function, class or arrow const without a docstring is rejected", async () => {
  for (const code of [
    "export function f(): number {\n  return 1;\n}\n",
    "export class A {}\n",
    "export const f = (): number => 1;\n",
  ]) {
    const found = await _reports("src/core/x.ts", code, "jsdoc/require-jsdoc");

    assert.equal(found.length, 1, code);
    assert.equal(found[0].severity, 2);
  }
});

test("a public method or getter without a docstring is rejected, on any class", async () => {
  const code = [
    "/** A. */",
    "export class A {",
    "  get b(): number {",
    "    return 1;",
    "  }",
    "",
    "  c(): number {",
    "    return 2;",
    "  }",
    "}",
    "",
    "/** Builds an inner one. */",
    "export function f(): object {",
    "  return new (class {",
    "    d(): void {}",
    "  })();",
    "}",
    "",
  ].join("\n");
  const found = await _reports("src/core/x.ts", code, "jsdoc/require-jsdoc");

  assert.deepEqual(
    found.map((m) => m.line),
    [3, 7, 15],
  );
});

test("documented exports, private members and module helpers pass the docstring rule", async () => {
  const code = [
    "/** A. */",
    "export class A {",
    "  constructor(private readonly _n: number) {}",
    "",
    "  /** B. */",
    "  b(): number {",
    "    return this._c();",
    "  }",
    "",
    "  private _c(): number {",
    "    return this._n;",
    "  }",
    "}",
    "",
    "/** F. */",
    "export function f(): number {",
    "  return _g();",
    "}",
    "",
    "function _g(): number {",
    "  return 1;",
    "}",
    "",
  ].join("\n");

  assert.deepEqual(
    await _reports("src/core/x.ts", code, "jsdoc/require-jsdoc"),
    [],
  );
});

test("test support helpers need docstrings too", async () => {
  const found = await _reports(
    "tests/support/x.ts",
    "export function f(): number {\n  return 1;\n}\n",
    "jsdoc/require-jsdoc",
  );

  assert.equal(found.length, 1);
});

test("a private member without a leading underscore is rejected", async () => {
  const code = [
    "/** A. */",
    "export class A {",
    "  private n = 1;",
    "",
    "  constructor(private readonly deps: number) {}",
    "",
    "  private get g(): number {",
    "    return this.n + this.deps;",
    "  }",
    "",
    "  private m(): number {",
    "    return this.g;",
    "  }",
    "}",
    "",
  ].join("\n");
  const found = await _reports("src/core/x.ts", code, NAMING);

  assert.deepEqual(
    found.map((m) => m.line),
    [3, 5, 7, 11],
  );
});

test("a public member or an export with a leading underscore is rejected", async () => {
  const code = [
    "/** A. */",
    "export class A {",
    "  _n = 1;",
    "",
    "  /** M. */",
    "  _m(): number {",
    "    return this._n;",
    "  }",
    "}",
    "",
    "/** F. */",
    "export function _f(): number {",
    "  return 1;",
    "}",
    "",
    "export const _C = 1;",
    "",
  ].join("\n");
  const found = await _reports("src/core/x.ts", code, NAMING);

  assert.deepEqual(
    found.map((m) => m.line),
    [3, 6, 12, 16],
  );
});

test("a module-private function or function const without a leading underscore is rejected", async () => {
  const code = [
    "/** F. */",
    "export function f(): number {",
    "  return g() + h();",
    "}",
    "",
    "function g(): number {",
    "  return 1;",
    "}",
    "",
    "const h = (): number => 2;",
    "",
  ].join("\n");
  const found = await _reports("src/core/x.ts", code, NAMING);

  assert.deepEqual(
    found.map((m) => m.line),
    [6, 10],
  );
});

test("module constants, nested functions and object keys keep their names", async () => {
  const code = [
    "const LIMIT = 3;",
    "",
    "/** F. */",
    "export function f(): object {",
    "  function inner(): number {",
    "    return LIMIT;",
    "  }",
    "",
    "  return { __WIRE_KEY__: inner() };",
    "}",
    "",
  ].join("\n");

  assert.deepEqual(await _reports("src/core/x.ts", code, NAMING), []);
});

test("a script helper without a leading underscore is rejected", async () => {
  const found = await _reports(
    "scripts/x.mjs",
    "function helper() {\n  return 1;\n}\n\nexport const a = helper();\n",
    NAMING,
  );

  assert.equal(found.length, 1);
});

test("a public method after a private one, or a field after a method, is rejected", async () => {
  for (const body of [
    ["  private _a(): void {}", "", "  /** B. */", "  b(): void {}"],
    ["  /** B. */", "  b(): void {}", "", "  c = 1;"],
    ["  /** B. */", "  b(): void {}", "", "  constructor() {}"],
  ]) {
    const code = ["/** A. */", "export class A {", ...body, "}", ""].join("\n");
    const found = await _reports(
      "src/core/x.ts",
      code,
      "@typescript-eslint/member-ordering",
    );

    assert.equal(found.length, 1, code);
    assert.equal(found[0].severity, 2);
  }
});

test("fields, constructor, public then private members pass the ordering rule", async () => {
  const code = [
    "/** A. */",
    "export class A {",
    "  b = 1;",
    "  private _c = 2;",
    "",
    "  constructor(private readonly _d: number) {}",
    "",
    "  /** E. */",
    "  get e(): number {",
    "    return this._f();",
    "  }",
    "",
    "  /** G. */",
    "  g(): number {",
    "    return this.b;",
    "  }",
    "",
    "  private _f(): number {",
    "    return this._c + this._d;",
    "  }",
    "}",
    "",
  ].join("\n");

  assert.deepEqual(
    await _reports("src/core/x.ts", code, "@typescript-eslint/member-ordering"),
    [],
  );
});

async function _reports(filePath, code, ruleId) {
  const [result] = await eslint.lintText(code, { filePath });

  return result.messages.filter((m) => m.ruleId === ruleId);
}
