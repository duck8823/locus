import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const layerBoundaryRule = (patterns) => [
  "error",
  {
    patterns,
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": layerBoundaryRule([
        {
          group: ["@/server/infrastructure/*"],
          message: "Framework files must stay above infrastructure implementations.",
        },
        {
          group: ["@/server/domain/*"],
          message: "Framework files should reach domain concepts through application/presentation helpers.",
        },
      ]),
    },
  },
  {
    files: ["src/server/presentation/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": layerBoundaryRule([
        {
          group: ["@/server/infrastructure/*"],
          message: "Presentation should not depend on infrastructure directly. Use the composition root.",
        },
      ]),
    },
  },
  {
    files: ["src/server/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": layerBoundaryRule([
        {
          group: ["@/app/*", "@/server/presentation/*", "@/server/infrastructure/*"],
          message: "Application code depends on domain and abstract ports, not on presentation or infrastructure.",
        },
        {
          group: ["next", "next/*"],
          message: "Application code must stay framework-agnostic.",
        },
      ]),
    },
  },
  {
    files: ["src/server/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": layerBoundaryRule([
        {
          group: [
            "@/app/*",
            "@/server/presentation/*",
            "@/server/application/*",
            "@/server/infrastructure/*",
          ],
          message: "Domain code must remain isolated from application, presentation, and infrastructure details.",
        },
        {
          group: ["next", "next/*"],
          message: "Domain code must not import framework utilities.",
        },
      ]),
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
