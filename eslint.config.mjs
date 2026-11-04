import stylistic from "@stylistic/eslint-plugin";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import jsdoc from "eslint-plugin-jsdoc";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

const CORE_TEST_MESSAGE =
  "core tests run without the Obsidian stub: use the fakes in tests/support/fakes.ts";

const DECLARATION_FILES = ["**/types.ts", "**/ports.ts", "**/errors.ts"];

const TYPES_OUT_OF_LOGIC_MESSAGE =
  "declare types in the module folder's types.ts (or ports.ts / errors.ts), never in a file that holds logic";

// `publicOnly` would skip the public methods of non-exported classes (modals,
// fakes), so the exported and public nodes are selected explicitly instead.
const DOCSTRING_CONTEXTS = [
  "ExportNamedDeclaration > FunctionDeclaration",
  "ExportDefaultDeclaration > FunctionDeclaration",
  "ExportNamedDeclaration > ClassDeclaration",
  "ExportDefaultDeclaration > ClassDeclaration",
  "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
  "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > FunctionExpression",
  "MethodDefinition:not([accessibility='private']):not([kind='constructor'])",
];

const MEMBER_ORDER = {
  memberTypes: [
    "signature",
    "field",
    "static-initialization",
    "constructor",
    ["public-get", "public-set", "public-method"],
    ["protected-get", "protected-set", "protected-method"],
    ["private-get", "private-set", "private-method"],
  ],
};

const CLASS_MEMBERS = [
  "classProperty",
  "parameterProperty",
  "classMethod",
  "classicAccessor",
  "autoAccessor",
];

const NAMING_RULES = [
  // Class members only: object-literal keys can be wire or build-time names.
  {
    selector: CLASS_MEMBERS,
    modifiers: ["private"],
    format: null,
    leadingUnderscore: "require",
  },
  { selector: CLASS_MEMBERS, format: null, leadingUnderscore: "forbid" },
  {
    selector: "function",
    modifiers: ["global"],
    format: null,
    leadingUnderscore: "require",
  },
  {
    selector: ["function", "variable", "class"],
    modifiers: ["exported", "global"],
    format: null,
    leadingUnderscore: "forbid",
  },
];

export default [
  {
    ignores: ["main.js", "node_modules/**", "esbuild.config.mjs"],
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
      // `brands` replaces the default list, so extend it. `mbr_sk_…` token
      // placeholders stay lowercase.
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
    files: ["tests/**/*.ts", "tests/**/*.mjs"],
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
  {
    // Core tests use the port fakes, so core stays testable without Obsidian.
    files: ["tests/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "obsidian", message: CORE_TEST_MESSAGE }],
          patterns: [
            {
              regex: "^@/(infra|ui|main)(/|$)",
              message:
                "core tests must not import infra, ui or main: drive core through the fakes in tests/support/fakes.ts",
            },
            {
              regex: "(^|/)stubs/|(^|/)support/(fixture-)?vault$",
              message: CORE_TEST_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // Repository scripts run in Node, never inside Obsidian; their console
    // output is the point.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly" } },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/rule-custom-message": "off",
      "no-new-func": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
      "boundaries/elements": [
        { type: "core", pattern: "src/core/**" },
        { type: "infra", pattern: "src/infra/**" },
        { type: "ui", pattern: "src/ui/**" },
      ],
      "boundaries/files": [
        { category: "main", pattern: ["src/main.ts", "src/types.ts"] },
      ],
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: { element: { type: "core" } },
              disallow: { to: { element: { type: "infra" } } },
              message:
                "core must not import infra: depend on an interface in core/ports.ts",
            },
            {
              from: { element: { type: "core" } },
              disallow: { to: { element: { type: "ui" } } },
              message:
                "core must not import ui: depend on an interface in core/ports.ts",
            },
            {
              from: { element: { type: "infra" } },
              disallow: { to: { element: { type: "ui" } } },
              message:
                "infra must not import ui: share the type through core, or have main.ts pass it in",
            },
            {
              from: { element: { type: "ui" } },
              disallow: { to: { element: { type: "infra" } } },
              message:
                "ui must not import infra: use the facade in ui/types.ts or a port from core/ports.ts",
            },
            {
              from: { element: { type: ["core", "infra", "ui"] } },
              disallow: { to: { file: { categories: "main" } } },
              message: "only main.ts wires the layers; nothing imports main.ts",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      // Any package, obsidian included, and any path outside core.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!@/core/)",
              message:
                "core imports only @/core: depend on an interface in core/ports.ts",
            },
          ],
        },
      ],
    },
  },
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          prev: "*",
          next: ["if", "for", "while", "do", "switch", "try", "return"],
        },
        {
          blankLine: "always",
          prev: ["if", "for", "while", "do", "switch", "try"],
          next: "*",
        },
        {
          blankLine: "always",
          prev: ["const", "let"],
          next: ["expression", "block-like"],
        },
      ],
    },
  },
  {
    // Fields, the constructor, public members in calling order, then the
    // private members; calling order itself is a review check.
    files: ["**/*.ts", "**/*.mjs"],
    rules: {
      "@typescript-eslint/member-ordering": [
        "error",
        {
          default: "never",
          classes: MEMBER_ORDER,
          classExpressions: MEMBER_ORDER,
        },
      ],
    },
  },
  {
    // Module-private helpers holding a function carry the `_` prefix too;
    // matching on the value's type needs the type-aware parser.
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        ...NAMING_RULES,
        {
          selector: "variable",
          modifiers: ["global"],
          types: ["function"],
          format: null,
          leadingUnderscore: "require",
        },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    rules: {
      "@typescript-eslint/naming-convention": ["error", ...NAMING_RULES],
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
    ignores: DECLARATION_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSEnumDeclaration",
        ].map((selector) => ({
          selector,
          message: TYPES_OUT_OF_LOGIC_MESSAGE,
        })),
      ],
    },
  },
  {
    files: [
      "src/**/*.ts",
      "tests/support/**/*.ts",
      "tests/lint/eslint-instance.mjs",
    ],
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            ArrowFunctionExpression: false,
            ClassDeclaration: false,
            ClassExpression: false,
            FunctionDeclaration: false,
            FunctionExpression: false,
            MethodDefinition: false,
          },
          contexts: DOCSTRING_CONTEXTS,
          checkConstructors: false,
          enableFixer: false,
        },
      ],
    },
  },
  prettier,
];
