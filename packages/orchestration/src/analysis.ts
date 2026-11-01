import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { OmniforgeError } from "@omniforge/shared-types";
import { planAnalysis } from "@omniforge/research-engine";
import { redactSecrets } from "@omniforge/utils";

export interface AnalysisSource { target: string; rightsEvidence: string }

/** Read-only, bounded structural inventory. Never imports or executes target code. */
export function writeAnalysis(source: AnalysisSource | undefined, workspace: string, request: string): string {
  if (!source) throw new OmniforgeError("E_AUTHORIZATION_REQUIRED", "analysis requires --target and --rights-evidence before inspection");
  planAnalysis({ target: `${source.target} ${request}`, format: "source-repo", rightsBasis: "authorized", rightsEvidence: source.rightsEvidence, expectedArtifacts: ["analysis-report"] });
  if (!/\b(inventory|structural|structure|files|hashes|manifest)\b/i.test(request)) throw new OmniforgeError("E_NEEDS_MODEL", "deterministic analysis supports structural file inventories only; behavioral analysis needs an authorized specialized probe/backend");
  const target = resolve(source.target);
  if (!existsSync(target)) throw new OmniforgeError("E_CAPABILITY_MISSING", "analysis target is missing");
  if (realpathSync(target) !== target) throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "analysis target must be a canonical path without symlinks");
  const rows: Array<{ path: string; bytes: number; sha256: string }> = [];
  let total = 0;
  const visit = (path: string, depth: number): void => {
    if (depth > 8 || rows.length >= 500 || total > 8_000_000) throw new OmniforgeError("E_BUDGET_EXCEEDED", "analysis inventory exceeds 500 files/8MB/depth 8; narrow target scope");
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "symlinks are outside analysis scope");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (["node_modules", ".git", ".env", ".omniforge"].includes(name) || name.startsWith(".env.")) continue;
        visit(join(path, name), depth + 1);
      }
    } else if (stat.isFile()) {
      total += stat.size;
      if (total > 8_000_000) throw new OmniforgeError("E_BUDGET_EXCEEDED", "analysis input exceeds 8MB");
      rows.push({ path: relative(target, path).split(sep).join("/") || "(target file)", bytes: stat.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
    }
  };
  visit(target, 0);
  if (!rows.length) throw new OmniforgeError("E_CAPABILITY_MISSING", "analysis target contains no inspectable files");
  mkdirSync(join(workspace, "report"), { recursive: true });
  const evidence = join(workspace, "report", "inventory.json");
  writeFileSync(evidence, JSON.stringify({ target, method: "bounded read-only SHA-256 inventory; no target execution", rows }, null, 2));
  const report = join(workspace, "report", "ANALYSIS.md");
  writeFileSync(report, redactSecrets(`# Structural analysis\n\n## Request\n${request}\n\n## Method and provenance\nAuthorized source: ${target}\nRights evidence: ${source.rightsEvidence}\nMethod: bounded filesystem metadata and SHA-256; target code was not executed.\n\n## Observations\n${rows.length} files, ${total} bytes were observed. Each row below references report/inventory.json.\n\n## evidence\n| file | bytes | SHA-256 |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.path.replaceAll("|", "\\|")} | ${r.bytes} | ${r.sha256} |`).join("\n")}\n\n## Inference\nFile presence and hashes establish an inventory only. Runtime behavior and correctness are untested.\n\n## Assumptions and limitations\nRights evidence is supplied by the operator. No protected behavior was recreated. Hidden environment files and dependency folders are excluded. This report makes no functional, security, or performance verdict. Reproduce with the same target bytes using Node fs and SHA-256.\n`));
  return report;
}
