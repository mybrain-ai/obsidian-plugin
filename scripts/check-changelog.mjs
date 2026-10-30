// Enforce that the version in manifest.json has a matching "## <version>"
// section in CHANGELOG.md. Run with --staged (pre-commit hook) to check the
// content that is about to be committed; without it (CI) to check the files
// on disk.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const staged = process.argv.includes("--staged");
const source = staged ? "the staged changes" : "the working tree";
const { version } = JSON.parse(_read("manifest.json"));

const hasSection = _read("CHANGELOG.md")
  .split("\n")
  .some((line) => line.trim() === `## ${version}`);

if (!hasSection) {
  console.error(
    `✗ CHANGELOG.md is missing a "## ${version}" section (version from ` +
      `manifest.json in ${source}).\n` +
      `  Add the release notes under "## ${version}" before committing.`,
  );
  process.exit(1);
}

console.log(`✓ CHANGELOG.md has a "## ${version}" section.`);

function _read(path) {
  if (staged) {
    return execFileSync("git", ["show", `:${path}`], { encoding: "utf8" });
  }

  return readFileSync(path, "utf8");
}
