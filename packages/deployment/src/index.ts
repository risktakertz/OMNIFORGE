/**
 * OMNIFORGE deployment — detection and free-first dry-run planning.
 * Generating software NEVER publishes it. Real deploys require an explicit
 * approval record plus an approved host; without one this package returns
 * typed blocked results instead of pretending.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OmniforgeError, type ThreatFinding } from "@omniforge/shared-types";

export type DeployTargetKind = "static" | "node" | "expo" | "tauri" | "godot" | "unknown";

export interface DeployOption {
  host: string;
  costNote: string;
  commercialUse: "verify-terms" | "permitted-with-attribution" | "unknown";
  steps: string[];
}

export interface DryRunReport {
  target: DeployTargetKind;
  workspaceId: string;
  options: DeployOption[];
  approvalsRequired: string[];
  estimatedCost: string;
  warnings: string[];
  findings: ThreatFinding[];
}

export function detectTarget(workspacePath: string): DeployTargetKind {
  const cfgPath = join(workspacePath, "project.config.json");
  if (!existsSync(cfgPath)) return "unknown";
  const templateId = String((JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>)["templateId"] ?? "");
  if (/static-business|commerce-lite|booking-lite|dashboard-lite|phaser-2d/.test(templateId)) return "static";
  if (/next-web|api/.test(templateId)) return "node";
  if (/expo-mobile/.test(templateId)) return "expo";
  if (/tauri-desktop/.test(templateId)) return "tauri";
  if (/godot-native/.test(templateId)) return "godot";
  return "unknown";
}

const STATIC_OPTIONS: DeployOption[] = [
  {
    host: "Cloudflare Pages (free tier)",
    costNote: "0 USD at current limits — reverify quotas + commercial terms before client deploys",
    commercialUse: "verify-terms",
    steps: ["pnpm build (or none for prebuilt dist/)", "wrangler pages deploy dist/"],
  },
  {
    host: "GitHub Pages",
    costNote: "0 USD for public repos; private repos need a paid plan",
    commercialUse: "verify-terms",
    steps: ["push dist/ to gh-pages branch or Actions workflow", "enable Pages"],
  },
  {
    host: "Any static file host / existing nginx",
    costNote: "0 USD marginal cost on infrastructure you already own",
    commercialUse: "permitted-with-attribution",
    steps: ["upload dist/ contents", "configure TLS at your proxy"],
  },
];

const NODE_OPTIONS: DeployOption[] = [
  {
    host: "Node host (existing server + process manager)",
    costNote: "0 USD marginal on owned infrastructure",
    commercialUse: "permitted-with-attribution",
    steps: ["pnpm install && pnpm build", "run under systemd/pm2", "reverse proxy with TLS"],
  },
  {
    host: "Platform free tier",
    costNote: "0 USD while within quota — every provider's current terms MUST be rechecked for commercial client use before recommending",
    commercialUse: "verify-terms",
    steps: ["connect repo", "set env vars via secret manager", "verify health endpoint externally"],
  },
];

export function dryRunDeploy(workspacePath: string): DryRunReport {
  const target = detectTarget(workspacePath);
  const cfg = existsSync(join(workspacePath, "project.config.json"))
    ? (JSON.parse(readFileSync(join(workspacePath, "project.config.json"), "utf8")) as Record<string, unknown>)
    : {};
  const warnings: string[] = [];
  let options: DeployOption[] = [];
  if (target === "static") options = STATIC_OPTIONS;
  else if (target === "node") options = NODE_OPTIONS;
  else {
    warnings.push(
      target === "expo"
        ? "mobile distribution requires store accounts, signing and review — a separately approved milestone"
        : target === "tauri"
          ? "desktop installers require platform SDKs and signing credentials"
          : target === "godot"
            ? "game export requires the Godot toolchain locally"
            : "unknown target: cannot produce an honest deployment plan"
    );
  }
  return {
    target,
    workspaceId: String(cfg["id"] ?? "unknown"),
    options,
    approvalsRequired: ["explicit human approval for any real deployment action"],
    estimatedCost: "0 USD (dry-run only; hosting costs depend on chosen option)",
    warnings,
    findings: [
      {
        id: "DEP-TM1",
        severity: "info",
        title: "Generation and deployment are separate gates",
        detail: "No deployment occurs as a side effect of creation; TLS, domain, backups and rollback are configured at the chosen host during an approved deploy.",
        remediation: "record approval before executing any deploy action",
      },
    ],
  };
}

/** Real deploys stay blocked until an approved adapter + approval exist (M5). */
export function executeDeploy(_workspacePath: string): never {
  throw new OmniforgeError(
    "E_DEPLOY_BLOCKED",
    "no approved deployment adapter is configured; run `omniforge deploy --dry-run` for a free-first plan, then configure an authorized host (docs/DEPLOYMENT_AND_ROLLBACK.md)"
  );
}
