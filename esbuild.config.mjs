import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const apiBase = process.env.MYBRAIN_API_BASE;

if (!apiBase) {
  console.error("MYBRAIN_API_BASE is not set");
  process.exit(1);
}

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
    ...builtins,
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
