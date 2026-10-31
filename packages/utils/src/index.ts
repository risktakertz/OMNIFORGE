import { randomUUID, createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";

export function newId(prefix = "id"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function shortHash(input: string, len = 8): string {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}

export function slugify(text: string, maxLen = 40): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (slug || "project").slice(0, maxLen).replace(/-$/, "");
}

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, label: "github-token" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, label: "api-key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "aws-key" },
  // \b stops variable names like "noToken"; [ \t]* keeps the match on one
  // line so multi-line .env.example placeholders never false-positive
  { re: /\b(?:api[_-]?key|secret|password|token)[ \t]*[:=][ \t]*["']?[^\s"',;)\n]{8,}/gi, label: "kv-secret" },
  { re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, label: "bearer" },
];

/** Redacts obvious secrets from arbitrary text before it reaches logs or disk. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, `[REDACTED:${label}]`);
  }
  return out;
}

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some(({ re }) => new RegExp(re.source, re.flags.replace("g", "")).test(text));
}

/** Resolves a candidate path and rejects escapes from `base` (symlink/traversal safe). */
export function safeJoin(base: string, candidate: string): string {
  const absBase = resolve(base);
  const abs = resolve(absBase, candidate);
  const rel = relative(absBase, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escape blocked: ${candidate}`);
  }
  return abs;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export function wordOverlap(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let hits = 0;
  for (const w of sa) if (sb.has(w)) hits++;
  return hits / sa.size;
}

/** Minimal argv parser: supports --flag value, --flag=value, --json, positionals. */
export function parseArgs(argv: string[]): {
  positionals: string[];
  flags: Record<string, string | boolean>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}
