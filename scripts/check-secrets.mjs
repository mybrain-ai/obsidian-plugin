// Scan for secrets with gitleaks: the staged changes by default (pre-commit
// hook), the whole git history with --history (CI). Only the staged scan is
// skipped, with a warning, when gitleaks isn't installed; CI installs it.
import { spawnSync } from "node:child_process";
import process from "node:process";

const history = process.argv.includes("--history");
const args = history
  ? ["git", "--redact", "--verbose", "."]
  : ["protect", "--staged", "--redact"];

const result = spawnSync("gitleaks", args, { stdio: "inherit" });

if (result.error && result.error.code === "ENOENT") {
  if (history) {
    console.error("gitleaks not installed; the history scan cannot run");
    process.exit(1);
  }

  console.log("gitleaks not installed; secret scan skipped (CI still runs it)");
  process.exit(0);
}

if (result.error) {
  console.error("gitleaks could not run:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
