import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // `no-undef` is not part of eslint-config-next, and its absence let free
  // variables reach shipped code: a merge can drop a `const` while keeping its
  // use, and lint still reports clean. Scoped to the code we own — every hit
  // here is a real undefined identifier, never a false positive (JSX and the
  // Next globals come from nextVitals).
  {
    files: ["src/**/*.{js,jsx,mjs}", "open-sse/**/*.{js,mjs}"],
    rules: {
      "no-undef": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated CLI build output — not source.
    ".next-cli-build/**",
    "cli/app/**",
    // Local merge/debug scratch.
    ".lintcmp/**",
  ]),
]);

export default eslintConfig;
