import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

export default [
  {
    ignores: ["main.js", "node_modules/**", "scripts/**", "esbuild.config.mjs"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `brands` replaces the default list, so extend it. Tokens are lowercase.
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          enforceCamelCaseLower: true,
          brands: [...DEFAULT_BRANDS, "MyBrain"],
          ignoreRegex: ["^mbr_sk_"],
        },
      ],
    },
  },
  {
    // Tests run in Node against stubs, not inside Obsidian.
    files: ["tests/**/*.ts"],
    rules: {
      // node:test's `test()` returns a promise the runner already tracks.
      "@typescript-eslint/no-floating-promises": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-window-timers": "off",
      // Tests replace globals (WebSocket, window) with fakes.
      "obsidianmd/no-global-this": "off",
      // Fixture vaults use Obsidian's default config folder name.
      "obsidianmd/hardcoded-config-path": "off",
    },
  },
];
