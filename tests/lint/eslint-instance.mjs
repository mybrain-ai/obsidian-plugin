import { ESLint } from "eslint";
import process from "node:process";

/** ESLint with the repo config. The sample files do not exist on disk, so the
 * type-aware parser takes them through the default project instead of the
 * real tsconfig. */
export function createEslint() {
  return new ESLint({
    overrideConfigFile: "eslint.config.mjs",
    cwd: process.cwd(),
    overrideConfig: {
      files: ["**/*.ts"],
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: [
              "src/*.ts",
              "src/core/*.ts",
              "src/infra/*.ts",
              "src/ui/*.ts",
              "tests/core/*.ts",
              "tests/support/*.ts",
            ],
          },
        },
      },
    },
  });
}
