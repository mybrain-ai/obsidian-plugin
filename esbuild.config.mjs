import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "node:process";

const prod = process.argv[2] === "production";

// Baked in as the default ingest endpoint, so `npm run build` (including the
// community directory's build verification) is reproducible with no
// environment. Local development doesn't need to change this: connecting via
// the deep link stores the local backend's endpoint in the plugin settings,
// which always take precedence over this default.
const apiBase = "https://backend.mybrain.ai/integrations/obsidian";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  alias: {
    "@": "./src",
  },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "node:*",
    ...builtinModules,
  ],
  define: {
    __MYBRAIN_API_BASE__: JSON.stringify(apiBase),
  },
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  try {
    await context.rebuild();
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await context.dispose();
  }
} else {
  try {
    await context.watch();
  } catch (err) {
    console.error(err);
    await context.dispose();
    process.exit(1);
  }
}
