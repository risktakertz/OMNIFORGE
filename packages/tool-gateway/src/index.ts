/**
 * OMNIFORGE tool gateway — deterministic policy in front of ALL tools and
 * external actions. Nothing here consults a model. Classes of action are
 * separated; filesystem writes are confined to approved roots; spend above
 * APPROVED_SPEND (default 0) requires approval; destructive operations require
 * approval. Every decision is auditable.
 */
import { existsSync, realpathSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";
import { OmniforgeError, ToolInvocation, type ToolInvocation as Invocation } from "@omniforge/shared-types";
import { newId, nowIso, redactSecrets } from "@omniforge/utils";

export type ActionClass =
  | "read-inspect"
  | "workspace-write"
  | "dependency-install"
  | "execute-code"
  | "network-fetch"
  | "repo-push"
  | "third-party-login"
  | "production-modify"
  | "public-post"
  | "payment"
  | "destructive-fs"
  | "deploy";

export const ACTION_RISK: Record<ActionClass, { risk: "low" | "medium" | "high"; needsApproval: boolean }> = {
  "read-inspect": { risk: "low", needsApproval: false },
  "workspace-write": { risk: "low", needsApproval: false },
  "dependency-install": { risk: "medium", needsApproval: false },
  "execute-code": { risk: "medium", needsApproval: false },
  "network-fetch": { risk: "low", needsApproval: false },
  "repo-push": { risk: "medium", needsApproval: false },
  "third-party-login": { risk: "high", needsApproval: true },
  "production-modify": { risk: "high", needsApproval: true },
  "public-post": { risk: "high", needsApproval: true },
  payment: { risk: "high", needsApproval: true },
  "destructive-fs": { risk: "high", needsApproval: true },
  deploy: { risk: "high", needsApproval: true },
};

export interface PolicyContext {
  /** Approved writable roots (workspace path(s), temp dirs). */
  writableRoots: string[];
  /** APPROVED_SPEND value (default 0). */
  approvedSpend: number;
  /** Permissions explicitly granted for this run. */
  permissions: string[];
  /** Approvals already recorded (approval request ids or 'auto:action'). */
  approvals: Set<string>;
}

export function defaultContext(writableRoots: string[]): PolicyContext {
  return {
    writableRoots,
    approvedSpend: Number(process.env.APPROVED_SPEND ?? "0") || 0,
    permissions: [],
    approvals: new Set(),
  };
}

export interface Decision {
  decision: "allow" | "deny" | "approval-required";
  actionClass: ActionClass;
  reason: string;
  invocation: Invocation;
}

export class ToolGateway {
  private readonly auditLog: Invocation[] = [];

  constructor(private readonly ctx: PolicyContext) {}

  classify(tool: string): ActionClass {
    if (/^(read|inspect|list|stat|grep|doctor|status)$/.test(tool)) return "read-inspect";
    if (/^(write|render|scaffold|copy|generate)$/.test(tool)) return "workspace-write";
    if (/^(install|pnpm-install|npm-install)$/.test(tool)) return "dependency-install";
    if (/^(run|exec|test|build)$/.test(tool)) return "execute-code";
    if (/^(fetch|download)$/.test(tool)) return "network-fetch";
    if (/^(git-push|push)$/.test(tool)) return "repo-push";
    if (/^(oauth|login)$/.test(tool)) return "third-party-login";
    if (/^(db-migrate|prod-write)$/.test(tool)) return "production-modify";
    if (/^(post|send-message|email|whatsapp)$/.test(tool)) return "public-post";
    if (/^(charge|pay|purchase|subscribe)$/.test(tool)) return "payment";
    if (/^(rm-rf|delete|format|force-push)$/.test(tool)) return "destructive-fs";
    if (/^(deploy|publish-site)$/.test(tool)) return "deploy";
    return "execute-code";
  }

  private confinedToRoots(target: string): boolean {
    const abs = resolve(target);
    return this.ctx.writableRoots.some((root) => {
      const absRoot = resolve(root);
      if (!existsSync(absRoot)) return false;
      let real: string;
      try {
        real = realpathSync(absRoot);
      } catch {
        return false;
      }
      // realpath the nearest EXISTING ancestor of the target so dangling
      // symlinks along the path cannot escape the root
      let probe = abs;
      const suffixes: string[] = [];
      while (probe !== "/" && !existsSync(probe)) {
        suffixes.unshift("/" + (probe.split(sep).pop() ?? ""));
        probe = resolve(probe, "..");
      }
      let realTarget: string;
      try {
        realTarget = existsSync(probe) ? realpathSync(probe) + suffixes.join("") : abs;
      } catch {
        return false;
      }
      return realTarget === real || realTarget.startsWith(real + sep);
    });
  }

  /**
   * Path safety for any write. Rejects escapes, symlink tricks and nonexistent
   * roots before an operation is allowed anywhere near the filesystem.
   */
  checkPath(target: string): void {
    if (!isAbsolute(target)) {
      throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "path must be absolute for gateway check", { target });
    }
    if (!this.confinedToRoots(target)) {
      throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "target path is outside approved writable roots", { target: redactSecrets(target) });
    }
  }

  authorize(tool: string, detail: Record<string, unknown> = {}): Decision {
    const actionClass = this.classify(tool);
    const policy = ACTION_RISK[actionClass];
    let decision: Decision["decision"] = "allow";
    let reason = "policy allow";

    if (policy.needsApproval) {
      const granted = [...this.ctx.approvals].some((a) => a === `auto:${tool}` || a.startsWith("apr_"));
      decision = granted ? "allow" : "approval-required";
      reason = granted ? "explicit approval on record" : `${actionClass} requires human approval`;
    }
    if (detail.spend !== undefined && Number(detail.spend) > this.ctx.approvedSpend) {
      decision = "approval-required";
      reason = `spend ${detail.spend} exceeds APPROVED_SPEND=${this.ctx.approvedSpend}`;
    }
    if (detail.target !== undefined && ["workspace-write", "destructive-fs", "execute-code"].includes(actionClass)) {
      try {
        this.checkPath(String(detail.target));
        if (actionClass === "workspace-write") reason = "path within approved roots";
      } catch (e) {
        decision = "deny";
        reason = (e as Error).message;
      }
    }
    if (actionClass === "payment" && this.ctx.approvedSpend === 0) {
      decision = decision === "allow" ? "approval-required" : decision;
      reason = "payment with APPROVED_SPEND=0 requires explicit human approval";
    }

    const invocation = ToolInvocation.parse({
      id: newId("ti"),
      tool,
      actionClass,
      policyDecision: decision,
      timestamp: nowIso(),
      ...(detail.durationMs !== undefined ? { durationMs: Number(detail.durationMs) } : {}),
      ...(detail.exit !== undefined ? { exit: String(detail.exit) } : {}),
    });
    this.auditLog.push(invocation);
    if (decision === "deny") {
      throw new OmniforgeError("E_GATEWAY_DENIED", reason, { tool, actionClass });
    }
    return { decision, actionClass, reason, invocation };
  }

  /** Records a human approval for a tool/action. */
  recordApproval(approvalId: string): void {
    this.ctx.approvals.add(approvalId);
  }

  audit(): Invocation[] {
    return [...this.auditLog];
  }

  /** First approved writable root — a safe cwd for read-only probes. */
  cwd(): string | null {
    return this.ctx.writableRoots[0] ?? null;
  }
}

/** Convenience: is this action allowed at all without approval? */
export function isReadOnly(tool: string): boolean {
  return ToolGateway.prototype.classify(tool) === "read-inspect";
}
