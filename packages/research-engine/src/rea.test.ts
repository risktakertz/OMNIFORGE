/**
 * REA pipeline tests (universal-upgrade §9): authorization gate, denial
 * tests, and the authorized toy-fixture analysis → spec → original
 * implementation → equivalence proof.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planAnalysis, analyzePricingFixture, loadBehaviorSpec } from "./rea.js";

const FIXTURE = fileURLToPath(new URL("../../../tests/fixtures/rea-sample-app/pricing.mjs", import.meta.url));

describe("authorization gate (§9.2)", () => {
  it("refuses DRM/licensing circumvention regardless of claimed authorization", () => {
    expect(() =>
      planAnalysis({ target: "crack the DRM of a commercial game", format: "binary", rightsBasis: "authorized", rightsEvidence: "i own a license", expectedArtifacts: ["analysis-report"] })
    ).toThrow(/E_AUTHORIZATION_REQUIRED/);
    expect(() =>
      planAnalysis({ target: "build a keygen for AppX", format: "binary", rightsBasis: "owner", rightsEvidence: "trust me completely", expectedArtifacts: ["analysis-report"] })
    ).toThrow(/E_AUTHORIZATION_REQUIRED/);
  });

  it("requires documented rights evidence for owner/authorized bases", () => {
    expect(() =>
      planAnalysis({ target: "my own app", format: "source-repo", rightsBasis: "owner", expectedArtifacts: ["analysis-report"] })
    ).toThrow(/E_AUTHORIZATION_REQUIRED/);
  });

  it("refuses binary/package analysis without a container sandbox (§9.4)", () => {
    // this host has no docker/podman → honest typed refusal, not host inspection
    expect(() =>
      planAnalysis({ target: "vendor.dll I own", format: "binary", rightsBasis: "owner", rightsEvidence: "written authorization on file", expectedArtifacts: ["analysis-report"] })
    ).toThrow(/E_SANDBOX_UNAVAILABLE/);
  });

  it("accepts a fully authorized source-repo analysis", () => {
    const plan = planAnalysis({
      target: "tests/fixtures/rea-sample-app (repo-owned sample)",
      format: "fixture",
      rightsBasis: "owner",
      rightsEvidence: "owned by this repository's test suite",
      expectedArtifacts: ["behavior-spec", "test-harness"],
    });
    expect(plan.id).toMatch(/^rea_/);
    expect(plan.sandboxRequired).toBe(false);
  });
});

describe("authorized toy-fixture pipeline (§9.7 acceptance)", () => {
  it("analyzes → behavior spec → ORIGINAL implementation → equivalence passes", () => {
    const plan = planAnalysis({
      target: "authorized sample: pricing module",
      format: "fixture",
      rightsBasis: "owner",
      rightsEvidence: "repo-owned fixture, written for this test",
      expectedArtifacts: ["behavior-spec", "test-harness"],
    });
    const out = mkdtempSync(join(tmpdir(), "of-rea-"));
    const res = analyzePricingFixture({ plan, fixturePath: FIXTURE, exportName: "price", outDir: out });
    // observed behavior recorded
    expect(res.behaviorMatrix.length).toBeGreaterThanOrEqual(20);
    expect(res.breakpoints).toContain(10);
    expect(res.breakpoints).toContain(50);
    // artifacts exist and separate observation from inference (§9.5)
    expect(existsSync(res.specPath)).toBe(true);
    expect(existsSync(res.specJsonPath)).toBe(true);
    expect(existsSync(res.implementationPath)).toBe(true);
    const md = readFileSync(res.specPath, "utf8");
    expect(md).toMatch(/Inference/);
    expect(md).toMatch(/Rights basis/);
    // ORIGINAL implementation is clean-room: it derives from the model, not a copy
    const impl = readFileSync(res.implementationPath, "utf8");
    expect(impl).toMatch(/ORIGINAL implementation/);
    expect(impl).not.toMatch(/qty <= 10/); // no copied source text
    // equivalence proof over the full domain (incl. beyond the probe grid)
    expect(res.equivalence.passed).toBe(true);
    expect(res.equivalence.cases).toBeGreaterThanOrEqual(100);
    expect(loadBehaviorSpec(res.specJsonPath)?.rows.length).toBe(res.behaviorMatrix.length);
  });

  it("is honest when the target does not fit the supported archetype", () => {
    const plan = planAnalysis({
      target: "authorized sample: string transform module",
      format: "fixture",
      rightsBasis: "owner",
      rightsEvidence: "repo-owned fixture",
      expectedArtifacts: ["behavior-spec"],
    });
    const out = mkdtempSync(join(tmpdir(), "of-rea-"));
    const weird = join(out, "weird.mjs");
    writeFileSync(weird, "export const transform = (x) => String(x) + '!';\n");
    expect(() => analyzePricingFixture({ plan, fixturePath: weird, exportName: "transform", outDir: out })).toThrow(/archetype mismatch/);
  });
});
