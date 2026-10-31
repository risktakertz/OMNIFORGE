import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";

// Alias every @omniforge/* workspace package to its TypeScript source so tests
// exercise the real source without requiring a build first.
const alias: Record<string, string> = {};
const packagesDir = new URL("packages/", import.meta.url);
for (const name of readdirSync(fileURLToPath(packagesDir))) {
  const entry = fileURLToPath(new URL(`packages/${name}/src/index.ts`, import.meta.url));
  if (existsSync(entry)) {
    alias[`@omniforge/${name}`] = entry;
  }
}

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    // suites that touch the shared projects/ dir must not run concurrently
    fileParallelism: false,
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: false,
  },
});
