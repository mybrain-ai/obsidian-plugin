import obsidianmd from "eslint-plugin-obsidianmd";

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
  },
];
