import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "docs/**",
    "pages-dist/**",
    // Runtime state, generated bundles and vendored browser libraries are not source.
    ".local/**",
    ".local-training/**",
    ".wrangler/**",
    ".vinext/**",
    ".openai/**",
    "outputs/**",
    "work/**",
    "coverage/**",
    "public/sim-assets/pdfjs/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    files: ["app/simulator/DrawingViewer.tsx"],
    rules: {
      // This labeled region scrolls with native arrow keys and must be reachable by Tab.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["region"] }],
    },
  },
  {
    files: ["app/simulator/reference-video/ReferenceVideoPlayer.tsx"],
    rules: {
      // Upstream teaching videos have no verified caption assets. Keep the debt visible;
      // do not fabricate an empty track to pretend captions exist.
      "jsx-a11y/media-has-caption": "warn",
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // Destructuring deliberately omits snapshot metadata before spreading the rest.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["app/training/scene/**/*.tsx"],
    rules: {
      // React Three Fiber JSX properties describe Three.js objects, not DOM attributes.
      "react/no-unknown-property": "off",
    },
  },
]);

export default eslintConfig;
