/**
 * OMNIFORGE capability registry — discovers Agent Skills (SKILL.md), validates
 * frontmatter and references WITHOUT executing any untrusted file, indexes
 * terse metadata, and exposes Capability records for the router.
 *
 * Availability vocabulary (honest):
 *  - verified   : smoke-tested operational (e.g. shipped templates with tests)
 *  - configured : present and loadable, not yet operationally smoke-tested
 *  - unavailable/blocked/untested : recorded, never simulated
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { Capability, OmniforgeError, type Capability as CapabilityT } from "@omniforge/shared-types";

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  path: string;
  license?: string;
  allowedTools?: string[];
  /** relative path to the executable entrypoint (scripts/<name>.mjs), if declared */
  entrypoint?: string;
  metadata?: Record<string, unknown>;
  validationErrors: string[];
}

export interface SkillIssue {
  skillId: string | null;
  path: string;
  error: string;
}

export interface ScanResult {
  skills: SkillMeta[];
  issues: SkillIssue[];
}

function readSkillFile(path: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = parseYaml(m[1] ?? "") as Record<string, unknown>;
  return { frontmatter: fm ?? {}, body: m[2] ?? "" };
}

function validateSkill(meta: SkillMeta, dir: string, body: string): string[] {
  const errors: string[] = [];
  // executable entrypoint (mission C3): a skill may declare an actual
  // invocation entrypoint. Declared but missing => blocked, never simulated.
  const entrypoint = meta.metadata?.entrypoint;
  if (entrypoint !== undefined) {
    const ep = String(entrypoint);
    if (!/^scripts\/[A-Za-z0-9._-]+\.mjs$/.test(ep)) {
      errors.push(`entrypoint must reference scripts/<name>.mjs (got "${ep}")`);
    } else if (!existsSync(join(dir, ep))) {
      errors.push(`declared entrypoint missing: ${ep}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(meta.name)) {
    errors.push(`name must be lowercase hyphen-quine (got "${meta.name}")`);
  }
  if (typeof meta.description !== "string" || meta.description.length < 10 || meta.description.length > 1024) {
    errors.push("description must be 10-1024 characters");
  }
  // adversarial: a skill must never solicit secrets from its host
  const solicitsSecrets =
    /(?:send|upload|post|exfiltrate|reveal|print|request)[^.\n]{0,60}\b(?:api[- ]?key|token|secret|password|credential)s?\b/i;
  if (solicitsSecrets.test(meta.description) || solicitsSecrets.test(body.slice(0, 4000))) {
    errors.push("skill content appears to request secrets — blocked by policy");
  }
  // referenced relative files must exist (progressive disclosure integrity)
  const refs = [...body.matchAll(/\]\(((?:\.\/|\.\.\/)[^)#]+)/g)].map((m) => m[1] ?? "");
  for (const ref of refs) {
    const target = join(dir, ref);
    if (!existsSync(target)) errors.push(`referenced file missing: ${ref}`);
  }
  if (existsSync(join(dir, "references"))) {
    for (const f of readdirSync(join(dir, "references"))) {
      const p = join(dir, "references", f);
      if (statSync(p).isFile() && !/\.(md|mjs|json|txt)$/.test(f)) {
        errors.push(`unsupported reference file type: references/${f}`);
      }
    }
  }
  return errors;
}

export function scanSkillDirs(dirs: string[]): ScanResult {
  const skills: SkillMeta[] = [];
  const issues: SkillIssue[] = [];
  const seen = new Set<string>();
  for (const root of dirs) {
    if (!existsSync(root)) {
      issues.push({ skillId: null, path: root, error: "scan path does not exist" });
      continue;
    }
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      const skillFile = join(dir, "SKILL.md");
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory() || !existsSync(skillFile)) continue;
      try {
        const parsed = readSkillFile(skillFile);
        if (!parsed) {
          issues.push({ skillId: null, path: skillFile, error: "missing YAML frontmatter block" });
          continue;
        }
        const name = String(parsed.frontmatter.name ?? entry);
        const meta: SkillMeta = {
          id: name,
          name,
          description: String(parsed.frontmatter.description ?? ""),
          path: dir,
          ...(typeof parsed.frontmatter.license === "string" ? { license: parsed.frontmatter.license } : {}),
          ...(parsed.frontmatter.entrypoint ? { entrypoint: String(parsed.frontmatter.entrypoint) } : {}),
          ...(parsed.frontmatter["allowed-tools"] ? { allowedTools: String(parsed.frontmatter["allowed-tools"]).split(",").map((s) => s.trim()) } : {}),
          metadata: parsed.frontmatter,
          validationErrors: [],
        };
        meta.validationErrors = validateSkill(meta, dir, parsed.body);
        if (seen.has(meta.id)) {
          issues.push({ skillId: meta.id, path: skillFile, error: `duplicate skill id "${meta.id}"` });
          continue;
        }
        seen.add(meta.id);
        skills.push(meta);
      } catch (e) {
        issues.push({ skillId: null, path: skillFile, error: `unreadable: ${(e as Error).message}` });
      }
    }
  }
  return { skills, issues };
}

export function skillToCapability(meta: SkillMeta): CapabilityT {
  return Capability.parse({
    id: `skill:${meta.id}`,
    kind: "skill",
    source: meta.path,
    version: String((meta.metadata?.version as string) ?? "0.1.0"),
    capabilities: Array.isArray(meta.metadata?.capabilities) ? (meta.metadata?.capabilities as string[]) : [meta.id],
    inputSchemaRef: "omniforge://schemas/project-intent",
    outputSchemaRef: "omniforge://schemas/skill-selection",
    requirements: Array.isArray(meta.metadata?.requirements) ? (meta.metadata?.requirements as string[]) : [],
    dependencies: Array.isArray(meta.metadata?.dependencies) ? (meta.metadata?.dependencies as string[]) : [],
    conflicts: Array.isArray(meta.metadata?.conflicts) ? (meta.metadata?.conflicts as string[]) : [],
    availability: meta.validationErrors.length === 0 ? "configured" : "blocked",
    risk: "low",
    cost: (meta.metadata?.cost as CapabilityT["cost"]) ?? "free",
    healthCheck: meta.metadata?.entrypoint
      ? `skill:entrypoint ${String(meta.metadata.entrypoint)} (executed with typed JSON stdin/stdout under the gateway)`
      : "registry:frontmatter-valid",
  });
}

export function templateCapabilities(templatesRoot: string): CapabilityT[] {
  if (!existsSync(templatesRoot)) return [];
  const caps: CapabilityT[] = [];
  for (const entry of readdirSync(templatesRoot)) {
    const dir = join(templatesRoot, entry);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (!existsSync(join(dir, "package.json"))) continue;
    // honest availability: template presence alone is NOT verification. A
    // template is "configured" until its own suite has been observed passing
    // (the repo's test suite records that evidence on every run).
    const hasSelfTest = existsSync(join(dir, "tests")) && readdirSync(join(dir, "tests")).some((f) => f.endsWith(".test.mjs"));
    caps.push(
      Capability.parse({
        id: `template:${entry}`,
        kind: "template",
        source: relative(process.cwd(), dir) || dir,
        version: "0.1.0",
        capabilities: [`scaffold-${entry}`],
        availability: hasSelfTest ? "configured" : "untested",
        risk: "low",
        cost: "free",
        healthCheck: hasSelfTest ? "template:self-test-declared (runs in repo suite)" : "none",
      })
    );
  }
  return caps;
}

/**
 * Built-in generators (composable project factories — not copied templates).
 * Availability is honest: "configured" until the acceptance suite observes a
 * real generation + passing tests on this revision.
 */
export function generatorCapabilities(): CapabilityT[] {
  return [
    Capability.parse({
      id: "generator:agent-mvp",
      kind: "tool",
      source: "packages/orchestration/src/agent-mvp.ts",
      version: "0.1.0",
      capabilities: ["compose-agent-mvp", "cli-agent-loop", "checkpoint-resume", "github-adapter", "allowlist-sandbox"],
      inputSchemaRef: "omniforge://schemas/project-intent",
      outputSchemaRef: "omniforge://schemas/workspace",
      requirements: ["node >= 20"],
      dependencies: [],
      conflicts: [],
      availability: "configured",
      risk: "low",
      cost: "free",
      healthCheck: "acceptance:e2e-agent-mvp (repo suite observes generation + tests)",
    }),
  ];
}

export class CapabilityRegistry {
  private readonly byId = new Map<string, CapabilityT>();
  private lastScan: ScanResult | null = null;

  constructor(private readonly skillRoots: string[], private readonly templatesRoot: string | null) {}

  rescan(): ScanResult {
    const result = scanSkillDirs(this.skillRoots);
    this.byId.clear();
    for (const s of result.skills) {
      const cap = skillToCapability(s);
      this.byId.set(cap.id, cap);
    }
    if (this.templatesRoot) {
      for (const t of templateCapabilities(this.templatesRoot)) {
        this.byId.set(t.id, t);
      }
    }
    for (const g of generatorCapabilities()) {
      this.byId.set(g.id, g);
    }
    this.lastScan = result;
    return result;
  }

  /** Scans on first use (lazy) so construction stays cheap. */
  ensure(): void {
    if (this.lastScan === null) this.rescan();
  }

  list(): CapabilityT[] {
    this.ensure();
    return [...this.byId.values()];
  }

  get(id: string): CapabilityT {
    this.ensure();
    const cap = this.byId.get(id);
    if (!cap) {
      throw new OmniforgeError("E_CAPABILITY_MISSING", `capability not found: ${id}`, { id });
    }
    return cap;
  }

  has(id: string): boolean {
    this.ensure();
    return this.byId.has(id);
  }

  issues(): SkillIssue[] {
    this.ensure();
    return this.lastScan?.issues ?? [];
  }

  /** Relative entrypoint path for a skill, or null when it has none. */
  entrypointOf(id: string): string | null {
    this.ensure();
    const meta = this.lastScan?.skills.find((sk) => `skill:${sk.id}` === id);
    return meta?.entrypoint ?? null;
  }

  validateAll(): { valid: boolean; errors: SkillIssue[]; skillErrors: Array<{ id: string; errors: string[] }> } {
    const scan = this.rescan();
    const skillErrors = scan.skills
      .filter((s) => s.validationErrors.length > 0)
      .map((s) => ({ id: s.id, errors: s.validationErrors }));
    return { valid: scan.issues.length === 0 && skillErrors.length === 0, errors: scan.issues, skillErrors };
  }
}
