// Run every tests/lint/*.test.mjs with Node's test runner. Listing the files
// here keeps the glob out of the shell and works on Node 20 and later.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const dir = "tests/lint";
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error(`no ${dir}/*.test.mjs files found`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});

if (result.error) console.error("node --test could not run:", result.error);

process.exitCode = result.status ?? 1;
