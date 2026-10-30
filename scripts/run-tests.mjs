// Bundle each tests/**/*.test.ts with esbuild (same `@/` alias as the plugin
// build plus `@test/` for tests/, `obsidian` swapped for
// tests/stubs/obsidian.ts, which has no runtime outside the app) and run the
// bundles with Node's built-in test runner.
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";

const entryPoints = _findTests("tests");

if (entryPoints.length === 0) {
  console.error("no tests/**/*.test.ts files found");
  process.exit(1);
}

const outdir = mkdtempSync(join(tmpdir(), "mybrain-tests-"));

try {
  await esbuild.build({
    entryPoints,
    outdir,
    outbase: "tests",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    alias: {
      "@": "./src",
      "@test": "./tests",
      obsidian: "./tests/stubs/obsidian.ts",
    },
    define: { __MYBRAIN_API_BASE__: JSON.stringify("https://example.test") },
    logLevel: "warning",
  });

  const bundles = entryPoints.map((p) =>
    join(outdir, relative("tests", p).replace(/\.ts$/, ".mjs")),
  );

  const result = spawnSync(process.execPath, ["--test", ...bundles], {
    stdio: "inherit",
  });

  if (result.error) console.error("node --test could not run:", result.error);

  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}

function _findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return _findTests(path);

    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}
