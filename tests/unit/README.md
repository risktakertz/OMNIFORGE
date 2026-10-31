# tests/unit

Unit tests live **colocated with each package** (`packages/*/src/*.test.ts`) so
they run against real sources via the root Vitest config (source aliases, no
build required). This directory holds only cross-package unit fixtures when a
test needs files outside its own package.

Run everything: `pnpm test`
