import { OmniforgeError } from "@omniforge/shared-types";
import { existsSync, mkdirSync, readFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteFile } from "@omniforge/utils";

/** Supplied by a trusted operator, never inferred from credentials or model text. */
export interface ModelCallPolicy {
  approvalId: string;
  provider: string;
  model: string;
  endpoint: string;
  cost: "verified-free" | "paid" | "unknown";
  approvedSpend: number;
  taskBudget: number;
  reservedPerCall: number;
  maxCalls: number;
}

export interface ModelCallLedger {
  calls: number;
  reserved: number;
}

/** Reserve conservatively BEFORE network activity; failed attempts still consume budget. */
export function modelCallDenial(
  policy: ModelCallPolicy | undefined,
  route: { provider: string; model: string; endpoint: string },
  ledger: ModelCallLedger
): string | null {
  if (typeof policy?.approvalId !== "string" || !policy.approvalId.trim()) return "explicit model route approval required; credentials do not authorize calls";
  const p = policy!;
  if (p.provider !== route.provider || p.model !== route.model || p.endpoint !== route.endpoint) return "model route does not match approved provider/model/endpoint";
  if (p.cost !== "paid" && p.cost !== "verified-free") return "unknown model cost is blocked";
  const numbers = [p.approvedSpend, p.taskBudget, p.reservedPerCall, p.maxCalls, ledger.calls, ledger.reserved];
  if (numbers.some((n) => !Number.isFinite(n) || n < 0) || !Number.isInteger(p.maxCalls) || !Number.isInteger(ledger.calls)) return "invalid model budget";
  if (p.cost === "paid" && (p.reservedPerCall <= 0 || p.approvedSpend <= 0 || p.taskBudget <= 0)) return "paid model calls require a positive approved budget and conservative reservation";
  if (p.cost === "verified-free" && p.reservedPerCall !== 0) return "free model route must reserve zero cost";
  if (ledger.calls >= p.maxCalls || ledger.reserved + p.reservedPerCall > Math.min(p.approvedSpend, p.taskBudget)) return "model invocation or spend budget exhausted";
  return null;
}

export function authorizeModelCall(policy: ModelCallPolicy | undefined, route: { provider: string; model: string; endpoint: string }, ledger: ModelCallLedger): void {
  const denial = modelCallDenial(policy, route, ledger);
  if (denial) throw new OmniforgeError("E_BUDGET_EXCEEDED", denial);
  ledger.calls++;
  ledger.reserved += policy!.reservedPerCall;
}

/** Shared durable reservation for orchestration phases, retries and resumes. */
export function reserveModelCall(policy: ModelCallPolicy | undefined, route: { provider: string; model: string; endpoint: string }, ledgerPath: string): ModelCallLedger {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const lockPath = `${ledgerPath}.lock`;
  let lock: number;
  try { lock = openSync(lockPath, "wx"); }
  catch { throw new OmniforgeError("E_BUDGET_EXCEEDED", "model budget is locked; verify the previous reservation before resuming"); }
  try {
    const ledger: ModelCallLedger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { calls: 0, reserved: 0 };
    const effective = policy ? { ...policy, approvedSpend: Math.min(policy.approvedSpend, Number(process.env.APPROVED_SPEND ?? "0")) } : undefined;
    authorizeModelCall(effective, route, ledger);
    atomicWriteFile(ledgerPath, JSON.stringify(ledger));
    return ledger;
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
