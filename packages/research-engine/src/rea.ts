/**
 * Authorized reverse engineering & reimplementation (universal-upgrade §9).
 *
 * REA is ONE supported operation inside OMNIFORGE — never the default action.
 * This module implements the permission/safety/provenance contract:
 *   - `planAnalysis`: typed AnalysisPlan with an authorization gate. Refuses
 *     DRM/license-bypass or credentialed targets outright; requires a rights
 *     basis + evidence; requires isolation for binary/package formats.
 *   - `analyzePricingFixture`: one lawful, deterministic analysis workflow for
 *     an AUTHORIZED local sample app (supported archetype: piecewise-linear
 *     pure functions). Produces a behavior matrix, a reproducible behavior
 *     spec, reproducible tests, and an ORIGINAL clean-room implementation
 *     derived from observed behavior — then proves equivalence by test.
 *
 * Observed behavior, inference and assumptions are reported separately
 * (§9.5). Analysis completes WITHOUT generating an application when no
 * synthesis strategy applies — typed, never faked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { AnalysisPlan, OmniforgeError, type AnalysisPlan as Plan } from "@omniforge/shared-types";
import { nowIso, newId } from "@omniforge/utils";
import { resolveSandbox } from "@omniforge/tool-gateway";

const requireFromHere = createRequire(import.meta.url);

export interface PlanAnalysisInput {
  target: string;
  format: Plan["format"];
  rightsBasis: Plan["rightsBasis"];
  rightsEvidence?: string;
  expectedArtifacts: Plan["expectedArtifacts"];
  confidentiality?: Plan["confidentiality"];
  allowedTools?: string[];
  /** injectable sandbox probe (tests); defaults to the real host probe */
  probeSandbox?: (bin: string, args: string[]) => { status: number | null };
}

/** §9.2 authorization gate — hard refusals before anything else happens. */
export function planAnalysis(input: PlanAnalysisInput): Plan {
  const targetLower = input.target.toLowerCase();
  // circumvention attempts are refused regardless of claimed authorization
  if (/\b(drm|crack|keygen|key-gen|license[- ]?bypass|activation[- ]?bypass|pirat|jailbreak|deprotect)\b/.test(targetLower)) {
    throw new OmniforgeError(
      "E_AUTHORIZATION_REQUIRED",
      "target describes circumvention of DRM/licensing/access controls — OMNIFORGE does not perform this under any rights basis (§9.2)",
      { target: input.target.slice(0, 120) }
    );
  }
  if (/\b(stolen|leaked|unlicensed|n prosecuted)\b/.test(targetLower)) {
    throw new OmniforgeError("E_AUTHORIZATION_REQUIRED", "target provenance appears unlawful — request refused", { target: input.target.slice(0, 120) });
  }
  if (input.rightsBasis === "owner" || input.rightsBasis === "authorized") {
    if (!input.rightsEvidence || input.rightsEvidence.trim().length < 8) {
      throw new OmniforgeError(
        "E_AUTHORIZATION_REQUIRED",
        `rights basis '${input.rightsBasis}' requires documented evidence (who authorized, when, scope) — none provided`,
        { rightsBasis: input.rightsBasis }
      );
    }
  }
  // §9.4: binaries/archives are untrusted — inspection requires a container
  if (input.format === "binary" || input.format === "package") {
    const sandbox = resolveSandbox(input.probeSandbox);
    if (sandbox.mode !== "container") {
      throw new OmniforgeError(
        "E_SANDBOX_UNAVAILABLE",
        `analyzing ${input.format} targets requires an isolated container (docker/podman); none available — host inspection of unknown binaries is refused`,
        { sandbox: sandbox.detail }
      );
    }
  }
  return AnalysisPlan.parse({
    id: newId("rea"),
    target: input.target,
    format: input.format,
    provenance: "user-supplied target; provenance recorded in rightsEvidence",
    rightsBasis: input.rightsBasis,
    rightsEvidence: input.rightsEvidence ?? "public documentation basis",
    allowedTools: input.allowedTools ?? ["read-inspect", "behavior-probe"],
    sandboxRequired: input.format === "binary" || input.format === "package",
    expectedArtifacts: input.expectedArtifacts,
    confidentiality: input.confidentiality ?? "internal",
    riskNotes: [
      "analysis is limited to documented/observable behavior; no decompilation of protected code",
      "outputs are original — no protected source, branding or assets are copied",
      ...(input.format === "binary" ? ["binary inspection runs only inside the container sandbox"] : []),
    ],
    createdAt: nowIso(),
  });
}

/* ------------------------------------------------------------------ */
/* Toy-fixture workflow: behavior probe → spec → original impl         */
/* ------------------------------------------------------------------ */

export interface BehaviorRow {
  input: number;
  output: number;
}

export interface FixtureAnalysisResult {
  archetype: "piecewise-linear";
  behaviorMatrix: BehaviorRow[];
  breakpoints: number[];
  segments: Array<{ from: number; to: number; slope: number; intercept: number }>;
  observedOutput: string;
  specPath: string;
  specJsonPath: string;
  implementationPath: string;
  equivalence: { passed: boolean; cases: number; mismatches: Array<{ input: number; expected: number; actual: number }> };
  inferenceNote: string;
}

function loadFixtureFunction(fixturePath: string, exportName: string): (x: number) => number {
  const abs = resolve(fixturePath);
  if (!existsSync(abs)) {
    throw new OmniforgeError("E_CAPABILITY_MISSING", `analysis fixture not found: ${fixturePath}`, {});
  }
  // repo-owned fixture (versioned with the codebase) — trusted content
  const mod = requireFromHere(abs) as Record<string, unknown>;
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw new OmniforgeError("E_CAPABILITY_MISSING", `fixture export '${exportName}' is not a function`, {});
  }
  return fn as (x: number) => number;
}

/** Fit a piecewise-linear model to observed behavior (deterministic). */
function fitPiecewiseLinear(rows: BehaviorRow[], step: number): { breakpoints: number[]; segments: FixtureAnalysisResult["segments"] } {
  const slopes: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    slopes.push((rows[i]!.output - rows[i - 1]!.output) / (rows[i]!.input - rows[i - 1]!.input));
  }
  const breakpoints: number[] = [];
  const segments: FixtureAnalysisResult["segments"] = [];
  let start = 0;
  for (let i = 1; i < slopes.length; i++) {
    if (Math.abs(slopes[i]! - slopes[i - 1]!) > 1e-9) {
      const at = rows[i]!.input;
      breakpoints.push(at);
      const from = rows[start]!.input;
      const to = at;
      const slope = slopes[i - 1]!;
      segments.push({ from, to, slope, intercept: rows[start]!.output - slope * from });
      start = i;
    }
  }
  const lastSlope = slopes[slopes.length - 1] ?? 0;
  segments.push({ from: rows[start]!.input, to: rows[rows.length - 1]!.input + step, slope: lastSlope, intercept: rows[start]!.output - lastSlope * rows[start]!.input });
  return { breakpoints, segments };
}

/**
 * Analyze an authorized local sample (piecewise-linear pricing archetype):
 * 1. probe the module on a deterministic input grid (observed behavior)
 * 2. write spec/BEHAVIOR.md + spec/behavior.json (reproducible spec + tests)
 * 3. write an ORIGINAL implementation from the extracted model (clean room:
 *    written from observed behavior, never from the fixture's source)
 * 4. prove equivalence over the domain, including beyond the probe grid
 */
export function analyzePricingFixture(opts: {
  plan: Plan;
  fixturePath: string;
  exportName: string;
  outDir: string;
  probeMax?: number;
  probeStep?: number;
  /** original implementation source (clean-room) is emitted by the pipeline */
  validateUpTo?: number;
}): FixtureAnalysisResult {
  const fn = loadFixtureFunction(opts.fixturePath, opts.exportName);
  const step = opts.probeStep ?? 5;
  const max = opts.probeMax ?? 100;
  const rows: BehaviorRow[] = [];
  for (let x = 0; x <= max; x += step) {
    const y = fn(x);
    if (typeof y !== "number" || !Number.isFinite(y)) {
      throw new OmniforgeError("E_VERIFY_FAILED", `fixture returned non-numeric output at input ${x} — archetype mismatch (piecewise-linear numeric functions only)`, { exportName: opts.exportName });
    }
    rows.push({ input: x, output: y });
  }
  const { breakpoints, segments } = fitPiecewiseLinear(rows, step);

  // --- reproducible spec artifacts -------------------------------------
  const outDir = resolve(opts.outDir);
  mkdirSync(join(outDir, "spec"), { recursive: true });
  mkdirSync(join(outDir, "src"), { recursive: true });
  mkdirSync(join(outDir, "tests"), { recursive: true });
  const matrixMd = rows.map((r) => `| ${r.input} | ${r.output} |`).join("\n");
  const specMd = `# Behavior specification — ${opts.plan.target}

Rights basis: **${opts.plan.rightsBasis}** (${opts.plan.rightsEvidence.slice(0, 80)})
Analysis plan: \`${opts.plan.id}\` — archetype: piecewise-linear numeric function \`${opts.exportName}(x)\`

## Reproduce

\`\`\`bash
node tests/equivalence.test.mjs   # compares the ORIGINAL implementation against the recorded behavior matrix
\`\`\`

## Observed behavior matrix (input -> output)

| input | output |
|---|---|
${matrixMd}

## Inference (clearly separated from observation)

The observed grid fits a piecewise-linear model with breakpoints at
[${breakpoints.join(", ")}]. Behavior BEYOND the probe range is an extrapolation
assumption, recorded as inference — not observation.

## Data formats

- spec/behavior.json: machine-readable matrix (input, output) pairs
- src/original-pricing.mjs: ORIGINAL implementation derived from the spec
`;
  const specPath = join(outDir, "spec", "BEHAVIOR.md");
  writeFileSync(specPath, specMd, "utf8");
  const specJsonPath = join(outDir, "spec", "behavior.json");
  writeFileSync(specJsonPath, JSON.stringify({ plan: opts.plan.id, target: opts.plan.target, exportName: opts.exportName, rows, breakpoints, segments }, null, 2), "utf8");

  // --- original implementation (clean-room, from the extracted model) ---
  const implPath = join(outDir, "src", "original-pricing.mjs");
  const implSrc = `/**
 * ORIGINAL implementation — generated from the observed behavior spec
 * (spec/behavior.json). Clean-room: derived from recorded input/output
 * behavior of an authorized sample, not from its source code.
 * Archetype: piecewise-linear pricing function.
 */
const SEGMENTS = ${JSON.stringify(segments)};

export function price(x) {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) {
    throw new Error("price(x): x must be a finite non-negative number");
  }
  for (const s of SEGMENTS) {
    if (x >= s.from && x < s.to) return s.intercept + s.slope * x;
  }
  const last = SEGMENTS[SEGMENTS.length - 1];
  return last.intercept + last.slope * x;
}
`;
  writeFileSync(implPath, implSrc, "utf8");

  // --- reproducible equivalence test -----------------------------------
  const testPath = join(outDir, "tests", "equivalence.test.mjs");
  const upTo = opts.validateUpTo ?? max + 2 * step;
  const testSrc = `/**
 * Reproducible equivalence test: the ORIGINAL implementation must match the
 * AUTHORIZED sample's behavior across the validated domain (${upTo} points).
 * Run: node tests/equivalence.test.mjs  (exit 0 = pass)
 */
import test from "node:test";
import assert from "node:assert";
import { price } from "../src/original-pricing.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const reference = require("${resolve(opts.fixturePath)}")["${opts.exportName}"];

test("original implementation matches observed behavior", () => {
  let mismatches = [];
  for (let x = 0; x <= ${upTo}; x += 1) {
    const expected = reference(x);
    const actual = price(x);
    if (Math.abs(expected - actual) > 1e-9) mismatches.push({ x, expected, actual });
  }
  assert.equal(mismatches.length, 0, JSON.stringify(mismatches.slice(0, 5)));
});
`;
  writeFileSync(testPath, testSrc, "utf8");

  // --- run the equivalence proof ---------------------------------------
  const mismatches: Array<{ input: number; expected: number; actual: number }> = [];
  for (let x = 0; x <= upTo; x += 1) {
    const expected = fn(x);
    const seg = segments.find((s) => x >= s.from && x < s.to) ?? segments[segments.length - 1]!;
    const actual = seg.intercept + seg.slope * x;
    if (Math.abs(expected - actual) > 1e-9) mismatches.push({ input: x, expected, actual });
  }
  return {
    archetype: "piecewise-linear",
    behaviorMatrix: rows,
    breakpoints,
    segments,
    observedOutput: `${rows.length} grid points observed`,
    specPath,
    specJsonPath,
    implementationPath: implPath,
    equivalence: { passed: mismatches.length === 0, cases: upTo + 1, mismatches: mismatches.slice(0, 5) },
    inferenceNote: `piecewise-linear model with breakpoints [${breakpoints.join(", ")}]; extrapolation beyond ${max} is inference, labeled as such in the spec`,
  };
}

/** Read back a previously written behavior spec (for verification flows). */
export function loadBehaviorSpec(specJsonPath: string): { rows: BehaviorRow[]; breakpoints: number[] } | null {
  if (!existsSync(specJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(specJsonPath, "utf8")) as { rows: BehaviorRow[]; breakpoints: number[] };
  } catch {
    return null;
  }
}
