/**
 * OMNIFORGE workspace manager — isolated project workspaces under projects/.
 * Each generated product gets its own directory copied from a template, its
 * own config, a lease/lock to prevent concurrent writers, and an export path
 * with provenance. Template changes never mutate delivered workspaces.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { OmniforgeError, WorkspaceLease, type WorkspaceLease as Lease, type ReleaseArtifact, type ProductBlueprint } from "@omniforge/shared-types";
import { newId, nowIso, slugify, shortHash, safeJoin } from "@omniforge/utils";
import { ToolGateway, registerProvenanceAuthority } from "@omniforge/tool-gateway";

export interface CreateWorkspaceOptions {
  templateId: string;
  /** e.g. "static-business" (without the template: prefix) */
  templateDirName?: string;
  name: string;
  params: Record<string, unknown>;
  projectsRoot: string;
  repoRoot: string;
  gateway: ToolGateway;
  force?: boolean;
}

export interface WorkspaceInfo {
  workspacePath: string;
  workspaceId: string;
  configPath: string;
  lease: Lease;
}

const LOCK_FILE = ".omniforge-lock.json";
const CONFIG_FILE = "project.config.json";
const BLUEPRINT_FILE = "project.blueprint.json";
const LOCK_TTL_MS = 30 * 60 * 1000;

function templatesRootOf(repoRoot: string): string {
  return join(repoRoot, "templates");
}

export function listTemplates(repoRoot: string): string[] {
  const root = templatesRootOf(repoRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => statSync(join(root, d), { throwIfNoEntry: false })?.isDirectory());
}

export function createWorkspace(opts: CreateWorkspaceOptions): WorkspaceInfo {
  // generator-mode workspaces (templateId "generator:<name>") start empty:
  // a composable generator writes the project instead of a copied template
  const generatorMode = opts.templateId.startsWith("generator:");
  const templateDirName = opts.templateDirName ?? opts.templateId.replace(/^(template|generator):/, "");
  const templateDir = join(templatesRootOf(opts.repoRoot), templateDirName);
  if (!generatorMode && !existsSync(templateDir)) {
    throw new OmniforgeError("E_CAPABILITY_MISSING", `template not found: ${templateDirName}`, { templateDir });
  }
  // gateway confines every write to the projects root
  opts.gateway.checkPath(resolve(opts.projectsRoot));
  mkdirSync(opts.projectsRoot, { recursive: true });

  const workspaceId = `${slugify(opts.name)}-${shortHash(`${opts.name}|${nowIso()}`, 6)}`;
  const workspacePath = safeJoin(opts.projectsRoot, workspaceId);
  if (existsSync(workspacePath) && !opts.force) {
    throw new OmniforgeError("E_GATEWAY_DENIED", "workspace already exists", { workspacePath });
  }
  opts.gateway.authorize("scaffold", { target: workspacePath });
  mkdirSync(workspacePath, { recursive: true });
  if (!generatorMode) {
    cpSync(templateDir, workspacePath, {
      recursive: true,
      filter: (src) => !/(node_modules|dist|\.turbo)$/.test(src),
    });
  }

  const configPath = join(workspacePath, CONFIG_FILE);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        id: workspaceId,
        templateId: opts.templateId,
        name: opts.name,
        params: opts.params,
        createdAt: nowIso(),
        generator: "omniforge@0.1.0",
        isolation: "independent workspace; safe to export",
      },
      null,
      2
    ),
    "utf8"
  );

  const lease = acquireLease(workspacePath, "workspace-manager");
  return { workspacePath, workspaceId, configPath, lease };
}

/**
 * Persist the ORIGINAL blueprint (acceptance criteria + scope) inside the
 * workspace before implementation. Verification and later modify operations
 * compare against this file — never against criteria derived from results.
 */
export function saveBlueprint(workspacePath: string, blueprint: ProductBlueprint, gateway: ToolGateway): string {
  gateway.checkPath(resolve(workspacePath));
  const p = join(workspacePath, BLUEPRINT_FILE);
  writeFileSync(p, JSON.stringify(blueprint, null, 2), "utf8");
  return p;
}

/**
 * Load the persisted original blueprint. Returns null (typed, honest) for
 * legacy workspaces created before contract v2 — callers must report the
 * missing baseline instead of inventing empty criteria.
 */
export function loadBlueprint(workspacePath: string): ProductBlueprint | null {
  const p = join(workspacePath, BLUEPRINT_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProductBlueprint;
  } catch {
    return null;
  }
}

export function acquireLease(workspacePath: string, holder: string): Lease {
  const lockPath = join(workspacePath, LOCK_FILE);
  if (existsSync(lockPath)) {
    const existing = JSON.parse(readFileSync(lockPath, "utf8")) as Lease;
    if (new Date(existing.expiresAt).getTime() > Date.now()) {
      throw new OmniforgeError("E_WORKSPACE_LOCKED", `workspace locked by ${existing.holder} until ${existing.expiresAt}`, {
        holder: existing.holder,
      });
    }
  }
  const lease = WorkspaceLease.parse({
    workspacePath,
    holder,
    acquiredAt: nowIso(),
    expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
  });
  writeFileSync(lockPath, JSON.stringify(lease, null, 2), "utf8");
  return lease;
}

export function releaseLease(workspacePath: string, holder: string): void {
  const lockPath = join(workspacePath, LOCK_FILE);
  if (!existsSync(lockPath)) return;
  const lease = JSON.parse(readFileSync(lockPath, "utf8")) as Lease;
  if (lease.holder !== holder) {
    throw new OmniforgeError("E_WORKSPACE_LOCKED", `cannot release lock held by ${lease.holder}`);
  }
  rmSync(lockPath);
}

export function readWorkspaceConfig(workspacePath: string): Record<string, unknown> {
  const p = join(workspacePath, CONFIG_FILE);
  if (!existsSync(p)) {
    throw new OmniforgeError("E_GATEWAY_DENIED", `not an OMNIFORGE workspace (missing ${CONFIG_FILE})`, { workspacePath });
  }
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

export function listWorkspaces(projectsRoot: string): Array<{ id: string; path: string; templateId: string; name: string }> {
  if (!existsSync(projectsRoot)) return [];
  const out: Array<{ id: string; path: string; templateId: string; name: string }> = [];
  for (const d of readdirSync(projectsRoot)) {
    const p = join(projectsRoot, d);
    const cfg = join(p, CONFIG_FILE);
    if (statSync(p, { throwIfNoEntry: false })?.isDirectory() && existsSync(cfg)) {
      const c = JSON.parse(readFileSync(cfg, "utf8")) as { id: string; templateId: string; name: string };
      out.push({ id: c.id, path: p, templateId: c.templateId, name: c.name });
    }
  }
  return out;
}

/**
 * Export: independent artifact (tar.gz) + provenance manifest with checksums.
 * The exported project runs standalone; nothing references OMNIFORGE at runtime.
 */
export function exportWorkspace(
  workspacePath: string,
  outDir: string,
  gateway: ToolGateway
): ReleaseArtifact {
  readWorkspaceConfig(workspacePath); // refuse to export non-OMNIFORGE dirs
  gateway.authorize("export", { target: workspacePath });
  gateway.checkPath(resolve(outDir));
  mkdirSync(outDir, { recursive: true });

  const manifest: Array<{ file: string; sha256: string }> = [];
  const walk = (dir: string, base: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === LOCK_FILE || entry === "node_modules" || entry === "dist-export") continue;
      const full = join(dir, entry);
      const rel = join(base, entry);
      if (statSync(full).isDirectory()) walk(full, rel);
      else
        manifest.push({
          file: rel,
          sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
        });
    }
  };
  walk(workspacePath, ".");

  const provenance = {
    exportedAt: nowIso(),
    workspaceId: safeReadConfig(workspacePath, "id"),
    templateId: safeReadConfig(workspacePath, "templateId"),
    generator: "omniforge@0.1.0",
    license: "MIT (template); see generated THIRD-PARTY-NOTICES.md",
    files: manifest.length,
  };
  const provPath = join(outDir, "provenance.json");
  writeFileSync(provPath, JSON.stringify(provenance, null, 2), "utf8");

  const archive = join(outDir, `${String(safeReadConfig(workspacePath, "id"))}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", workspacePath, "."], { stdio: "ignore" });

  return {
    id: newId("artifact"),
    path: archive,
    checksum: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    provenanceRef: provPath,
    createdAt: nowIso(),
  };
}

function safeReadConfig(workspacePath: string, key: string): string {
  const cfg = JSON.parse(readFileSync(join(workspacePath, CONFIG_FILE), "utf8")) as Record<string, unknown>;
  return String(cfg[key] ?? "unknown");
}

/* ------------------------------------------------------------------ */
/* Compose-time provenance manifest (universal-upgrade §3.3/§6.2)      */
/* ------------------------------------------------------------------ */

export interface ProvenanceManifest {
  generator: string;
  recordedAt: string;
  /** relative path -> sha256 at compose time */
  files: Record<string, string>;
}

/**
 * Record the sha256 of every file the generator just wrote. Later, the
 * execution trust boundary compares workspace scripts against this manifest:
 * byte-identical content is trusted provenance; anything edited afterwards is
 * untrusted generated code and requires a container (or is refused).
 */
export function recordProvenance(
  workspacePath: string,
  files: string[],
  gateway: ToolGateway,
  generator = "omniforge@0.2.0"
): string {
  gateway.checkPath(resolve(workspacePath));
  const manifest: ProvenanceManifest = { generator, recordedAt: nowIso(), files: {} };
  for (const rel of files) {
    const abs = join(workspacePath, rel);
    if (existsSync(abs) && statSync(abs).isFile()) {
      manifest.files[rel.split("\\").join("/")] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  }
  const dir = join(workspacePath, ".omniforge");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "provenance.json");
    writeFileSync(out, JSON.stringify({ ...manifest, authorityId: registerProvenanceAuthority(workspacePath, manifest.files) }, null, 2), "utf8");
  return out;
}

export function loadProvenance(workspacePath: string): ProvenanceManifest | null {
  const p = join(workspacePath, ".omniforge", "provenance.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProvenanceManifest;
  } catch {
    return null;
  }
}

export { newId };
