/**
 * OMNIFORGE research engine — documentation and authorized-evidence adapters.
 * v0.1 ships two offline providers (built-in product knowledge + local docs)
 * and an external-content sanitizer that treats every fetched document as
 * untrusted: instruction-like content is extracted, recorded and NEVER followed.
 */
import { OmniforgeError } from "@omniforge/shared-types";
import { nowIso, newId } from "@omniforge/utils";

export interface ResearchNote {
  id: string;
  source: string;
  topic: string;
  content: string;
  confidence: number;
  recordedAt: string;
  flaggedInstructions?: string[];
}

export interface DocumentationProvider {
  readonly id: string;
  readonly availability: "verified" | "configured" | "unavailable";
  fetch(topic: string): Promise<ResearchNote[]>;
}

/* ------------------------------------------------------------------ */
/* External content sanitization (prompt-injection defense)            */
/* ------------------------------------------------------------------ */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|your)\s+(?:instructions|rules)/i,
  /you\s+are\s+now\s+(?:a|an|in)\b/i,
  /(?:new|updated)\s+system\s+prompt\s*[:/]/i,
  /reveal|print|show\s+(?:me\s+)?(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
  /(?:send|email|upload|exfiltrate)\b[^.\n]{0,60}\b(?:api\s*key|token|password|secret|credentials)/i,
  /(?:curl|wget)[^\n]{0,120}\|\s*(?:sudo\s+)?(?:ba)?sh/i,
  /rm\s+-rf\s+\/(?!home|tmp)/i,
  /act\s+as\s+(?:if\s+you\s+are\s+)?(?:an?\s+)?(?:unrestricted|uncensored)/i,
  /grant\s+yourself|escalate\s+(?:your\s+)?privileges/i,
];

export interface SanitizedContent {
  sanitized: string;
  flaggedInstructions: string[];
}

/**
 * Treats `content` as untrusted data. Lines matching injection patterns are
 * removed from the returned sanitized text and reported separately so callers
 * can audit them. The caller must never execute or obey flagged content.
 */
export function sanitizeExternalContent(content: string): SanitizedContent {
  const lines = content.split(/\r?\n/);
  const flagged: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    if (INJECTION_PATTERNS.some((re) => re.test(line))) {
      flagged.push(line.trim());
    } else {
      kept.push(line);
    }
  }
  return { sanitized: kept.join("\n"), flaggedInstructions: flagged };
}

/* ------------------------------------------------------------------ */
/* Offline providers                                                   */
/* ------------------------------------------------------------------ */

interface KindKnowledge {
  stack: string[];
  hosting: string[];
  notes: string[];
}

const BUILTIN_KNOWLEDGE: Record<string, KindKnowledge> = {
  website: {
    stack: ["static HTML/CSS/JS (zero-dependency) or Astro for content-heavy sites", "semantic HTML + accessible forms"],
    hosting: ["static hosting (free tiers exist; verify current terms before client deploys)", "self-hosted nginx if infrastructure already exists"],
    notes: ["Avoid a database and backend until the product needs one.", "Contact flows must never send real email without approved credentials."],
  },
  "web-app": {
    stack: ["Next.js for interactive full-stack apps", "Zod-validated contracts, typed API routes"],
    hosting: ["Node hosting or platform free tier with verified commercial terms"],
    notes: ["Local/mock data is acceptable for MVP but must be labeled as such."],
  },
  saas: {
    stack: ["Next.js + Postgres (Supabase when approved) + RLS for tenant isolation"],
    hosting: ["managed Postgres free tiers have quotas; verify before recommending"],
    notes: ["Tenant isolation tests are mandatory before any multi-tenant claim."],
  },
  mobile: {
    stack: ["Expo (React Native, TypeScript, Expo Router)"],
    hosting: ["device builds require local Android SDK or EAS (paid for cloud builds)"],
    notes: ["No iOS simulator or App Store claims without a Mac, certificates and enrollment."],
  },
  desktop: {
    stack: ["Tauri (Rust shell) by default; Electron only for confirmed Node-specific needs"],
    hosting: ["installers require signing credentials (separate approved milestone)"],
    notes: ["Rust toolchain must exist locally to build; otherwise report blocked."],
  },
  api: {
    stack: ["TypeScript strict, Zod-validated input, Node runtime, zero heavy frameworks"],
    hosting: ["container or Node host; static hosts are not sufficient"],
    notes: ["Rate limiting and auth boundaries are part of the MVP contract, not extras."],
  },
  "game-2d": {
    stack: ["Phaser via CDN or npm for browser games; game logic kept in pure modules for node tests"],
    hosting: ["any static host"],
    notes: ["Interactive loop, controls, scoring and restart are MVP requirements, not polish."],
  },
  "game-3d": {
    stack: ["Godot project for engine-native games; Three.js/R3F for browser 3D"],
    hosting: ["web export via static host once engine toolchain exists locally"],
    notes: ["Headless validation requires the Godot binary; without it, verification is blocked, not faked."],
  },
  ai: {
    stack: ["provider-agnostic adapter; local Ollama if hardware allows; graceful no-credential mode"],
    hosting: ["depends on chosen provider; never assume free model quotas"],
    notes: ["AI outputs are untrusted input: validate before acting on them."],
  },
  automation: {
    stack: ["workflow engine in mock/sandbox mode by default; Activepieces CE only when license-eligible and justified"],
    hosting: ["worker process required for real schedules"],
    notes: ["No external message is ever sent without explicit approval and credentials."],
  },
};

export class StaticKnowledgeProvider implements DocumentationProvider {
  readonly id = "builtin-static";
  readonly availability = "verified" as const;

  async fetch(topic: string): Promise<ResearchNote[]> {
    const key = topic.toLowerCase().trim();
    const hit = BUILTIN_KNOWLEDGE[key];
    if (!hit) return [];
    return [
      {
        id: newId("note"),
        source: this.id,
        topic: key,
        content: [
          `Recommended stack: ${hit.stack.join("; ")}.`,
          `Hosting options: ${hit.hosting.join("; ")}.`,
          `Notes: ${hit.notes.join(" ")}`,
        ].join("\n"),
        confidence: 0.8,
        recordedAt: nowIso(),
      },
    ];
  }
}

export class LocalDocsProvider implements DocumentationProvider {
  readonly id = "local-docs";
  readonly availability = "verified" as const;
  constructor(private readonly docsRoot: string) {}

  async fetch(topic: string): Promise<ResearchNote[]> {
    const { readFileSync, readdirSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    if (!existsSync(this.docsRoot)) return [];
    const notes: ResearchNote[] = [];
    const wanted = topic.toLowerCase();
    for (const f of readdirSync(this.docsRoot)) {
      if (!f.toLowerCase().endsWith(".md")) continue;
      const text = readFileSync(join(this.docsRoot, f), "utf8");
      const { sanitized, flaggedInstructions } = sanitizeExternalContent(text);
      if (wanted.length === 0 || sanitized.toLowerCase().includes(wanted)) {
        notes.push({
          id: newId("note"),
          source: `local-docs:${f}`,
          topic: wanted,
          content: sanitized.slice(0, 4000),
          confidence: 0.6,
          recordedAt: nowIso(),
          ...(flaggedInstructions.length > 0 ? { flaggedInstructions } : {}),
        });
      }
    }
    return notes.slice(0, 10);
  }
}

/** Hosted docs retrieval (Context7 or similar) — configured only, off by default. */
export class HostedDocsProvider implements DocumentationProvider {
  readonly id = "hosted-docs";
  readonly availability = "unavailable" as const;
  constructor(private readonly reason = "no provider credentials configured") {}
  async fetch(_topic: string): Promise<ResearchNote[]> {
    throw new OmniforgeError("E_BACKEND_UNAVAILABLE", `hosted docs unavailable: ${this.reason}`);
  }
}

// Authorized reverse engineering (v1.2, §9)
export {
  planAnalysis,
  analyzePricingFixture,
  loadBehaviorSpec,
  type PlanAnalysisInput,
  type BehaviorRow,
  type FixtureAnalysisResult,
} from "./rea.js";
