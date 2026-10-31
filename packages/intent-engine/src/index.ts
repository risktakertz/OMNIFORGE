/**
 * OMNIFORGE intent engine — deterministic request interpretation.
 * Understands short, informal, multilingual (English + Swahili) requests and
 * produces a validated ProjectIntent: explicit requirements, inferred
 * assumptions with confidence, unknowns ranked by impact, and constraints.
 * LLM-assisted interpretation can later wrap this deterministic baseline;
 * policy decisions never depend on a model.
 */
import { ProjectIntent, OperationKind, ProductKind, OmniforgeError, type ProjectIntent as Intent } from "@omniforge/shared-types";
import { newId, tokenize, nowIso } from "@omniforge/utils";

const KIND_KEYWORDS: Array<{ kind: ProductKind; words: string[] }> = [
  { kind: "website", words: ["website", "web site", "webpage", "web page", "landing page", "portfolio", "homepage", "blog", "tovuti", "wavuti", "ukurasa"] },
  { kind: "web-app", words: ["web app", "web application", "management system", "portal", "dashboard", "admin panel", "crm", "booking system", "school management", "system ya", "mfumo", "dashibodi"] },
  { kind: "saas", words: ["saas", "subscription platform", "multi-tenant", "sell to shops", "white-label"] },
  { kind: "mobile", words: ["android", "ios app", "mobile app", "phone app", "react native", "apk", "app ya simu", "programu ya simu"] },
  { kind: "desktop", words: ["desktop app", "windows app", "mac app", "linux app", "installer", "desktop application"] },
  { kind: "api", words: ["api", "rest api", "graphql", "backend service", "endpoint", "microservice"] },
  { kind: "game-2d", words: ["2d game", "2d racing", "racing game", "platformer", "space shooter", "shooter", "puzzle game", "arcade", "game in the browser", "mchezo"] },
  { kind: "game-3d", words: ["3d game", "3d adventure", "open world", "fps", "first person", "3d"] },
  { kind: "ai", words: ["ai-powered", "chatbot", "customer support app with ai", "machine learning", "ai assistant", "llm"] },
  { kind: "automation", words: ["automation", "automated", "workflow", "reminder system", "integrate", "zapier-like", "notification system"] },
];

const OPERATION_KEYWORDS: Array<{ op: OperationKind; words: string[] }> = [
  { op: "create", words: ["create", "build", "make", "generate", "design", "develop", "umba", "tengeneza", "unda"] },
  { op: "modify", words: ["modify", "improve", "update", "change", "extend", "add to", "refactor", "badilisha", "ongeza", "boresha"] },
  { op: "debug", words: ["fix", "broken", "error", "bug", "crash", "not working", "rekebisha", "imeharibika"] },
  { op: "analyze", words: ["analyze", "analyse", "inspect", "review", "audit", "chunguza", "kagua"] },
  { op: "test", words: ["test only", "write tests", "verify", "jaribu", "pima"] },
  { op: "deploy", words: ["deploy", "publish online", "put it on the internet", "host it", "tangaza mtandaoni"] },
];

const SWAHILI_MARKERS = [
  "umba", "tengeneza", "unda", "tovuti", "wavuti", "duka", "mfumo", "mchezo",
  "simu", "programu", "mgahawa", "shule", "na ", "ya ", "wa ", "kwa ",
  "rekebisha", "haraka", "rahisi", "nzuri", "kamilisha", "chunguza",
];

const PLATFORM_KEYWORDS: Array<{ platform: string; words: string[] }> = [
  { platform: "web", words: ["web", "browser", "website", "online", "tovuti"] },
  { platform: "android", words: ["android", "apk", "play store"] },
  { platform: "ios", words: ["ios", "iphone", "app store"] },
  { platform: "windows", words: ["windows", "exe"] },
  { platform: "macos", words: ["mac", "macos", "dmg"] },
  { platform: "linux", words: ["linux", "appimage"] },
];

const KIND_ASSUMPTIONS: Record<ProductKind, Array<{ text: string; confidence: number }>> = {
  website: [
    { text: "Responsive layout for phones and desktop", confidence: 0.85 },
    { text: "Include a contact path (form, email or WhatsApp link)", confidence: 0.75 },
    { text: "Basic SEO metadata and accessible markup", confidence: 0.75 },
  ],
  "web-app": [
    { text: "Data stored locally or in a simple database unless a hosted backend is approved", confidence: 0.7 },
    { text: "Responsive admin-friendly UI", confidence: 0.7 },
  ],
  saas: [
    { text: "Multi-tenant isolation is a hard requirement", confidence: 0.9 },
    { text: "Billing is interface-only until a payment provider is approved", confidence: 0.9 },
  ],
  mobile: [
    { text: "Expo/React Native path with TypeScript", confidence: 0.7 },
    { text: "Device/emulator testing only if tooling is available; otherwise honest blocked status", confidence: 0.8 },
  ],
  desktop: [
    { text: "Tauri shell preferred when native requirements allow", confidence: 0.65 },
  ],
  api: [
    { text: "Typed contracts with validation on every input", confidence: 0.85 },
  ],
  "game-2d": [
    { text: "Keyboard/touch controls and a restart path", confidence: 0.8 },
    { text: "No accounts, no cloud: pure client-side game", confidence: 0.85 },
  ],
  "game-3d": [
    { text: "Godot native project; engine must be installed locally for full validation", confidence: 0.75 },
  ],
  ai: [
    { text: "AI features degrade gracefully without provider credentials", confidence: 0.85 },
  ],
  automation: [
    { text: "All external sending runs in mock/sandbox mode until explicitly approved", confidence: 0.95 },
  ],
};

function matchesAny(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w));
}

function detectLocale(request: string): "en" | "sw" {
  const lower = ` ${request.toLowerCase()} `;
  const hits = SWAHILI_MARKERS.filter((m) => lower.includes(m)).length;
  return hits >= 1 ? "sw" : "en";
}

function detectKinds(request: string): ProductKind[] {
  const lower = request.toLowerCase();
  const kinds: ProductKind[] = [];
  for (const { kind, words } of KIND_KEYWORDS) {
    if (matchesAny(lower, words)) kinds.push(kind);
  }
  // disambiguation: "3d" implies game-3d even if the word game is implicit
  if (kinds.length === 0) {
    if (/\b(shop|store|duka|commerce|amazon|market)\b/.test(lower)) return ["web-app"];
    return ["website"];
  }
  if (kinds.includes("game-3d") && kinds.includes("game-2d")) {
    return kinds.filter((k) => k !== "game-2d");
  }
  return kinds;
}

function detectOperation(request: string): OperationKind {
  const lower = request.toLowerCase();
  for (const { op, words } of OPERATION_KEYWORDS) {
    if (matchesAny(lower, words)) return op;
  }
  return "create";
}

function detectPlatforms(request: string, kinds: ProductKind[]): string[] {
  const lower = request.toLowerCase();
  const found = PLATFORM_KEYWORDS.filter(({ words }) => matchesAny(lower, words)).map((p) => p.platform);
  if (found.length === 0) {
    if (kinds.includes("mobile")) return ["android", "ios"];
    if (kinds.includes("desktop")) return ["windows", "macos", "linux"];
    return ["web"];
  }
  return found;
}

function extractRequirements(request: string): string[] {
  const requirements: string[] = [];
  const quoted = request.match(/["“']([^"”']{3,80})["”']/g);
  if (quoted) requirements.push(...quoted.map((q) => q.replace(/["“”']/g, "").trim()));
  const markers = /\b(?:with|including|that has|featuring|for (?:my|a|an|the)|using|na |yenye |iliyo na )\s+([^.,;]{3,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = markers.exec(request)) !== null) {
    const frag = (m[1] ?? "").trim();
    if (frag.length >= 3) requirements.push(frag);
  }
  // de-duplicate, keep readable
  return [...new Set(requirements.map((r) => r.toLowerCase()))].slice(0, 12);
}

function domainWords(request: string): string[] {
  return tokenize(request).filter(
    (w) =>
      ![
        "create", "build", "make", "website", "site", "app", "application", "like",
        "umba", "tovuti", "programu", "simple", "nice", "good", "great", "my", "a",
        "an", "the", "for", "with", "and", "or", "system", "page", "web",
      ].includes(w)
  );
}

function detectUnknowns(request: string, kinds: ProductKind[]): Intent["unknowns"] {
  const unknowns: Intent["unknowns"] = [];
  const lower = request.toLowerCase();
  if (kinds.some((k) => k === "website" || k === "web-app") && !/(name|jina)/.test(lower)) {
    unknowns.push({ question: "What is the business or project name to feature?", impact: "low" });
  }
  if (/(amazon|marketplace|ecommerce|e-commerce|shop|duka)/.test(lower)) {
    unknowns.push({ question: "Should checkout be a safe mock flow (no real payments) for now?", impact: "material" });
  }
  if (/(app store|play store|publish)/.test(lower)) {
    unknowns.push({ question: "Store publishing needs developer accounts and signing credentials — proceed without publishing for now?", impact: "blocking" });
  }
  if (kinds.includes("game-3d")) {
    unknowns.push({ question: "Is the Godot engine installed locally for validation and export?", impact: "material" });
  }
  return unknowns.slice(0, 5);
}

export interface ParseOptions {
  id?: string;
  /** Extra permissions claimed by the caller (never implied by the request text). */
  permissions?: string[];
  /** Mark the run as a resume of an earlier run. */
  resumeOf?: string;
}

export function parseRequest(request: string, opts: ParseOptions = {}): Intent {
  const trimmed = request.trim();
  if (trimmed.length < 3) {
    throw new OmniforgeError("E_INTENT_UNCLEAR", "request is too short to interpret", { request });
  }
  const kinds = detectKinds(trimmed);
  const operation = detectOperation(trimmed);
  const locale = detectLocale(trimmed);
  const platforms = detectPlatforms(trimmed, kinds);
  const explicitRequirements = extractRequirements(trimmed);
  const inferredAssumptions = kinds.flatMap((k) => KIND_ASSUMPTIONS[k] ?? []);
  const constraints: string[] = [];
  if (/(no budget|zero budget|free|bila malipo|ghali)/.test(trimmed.toLowerCase())) {
    constraints.push("free-first: no paid services without explicit approval");
  }
  if (opts.resumeOf) constraints.push(`resume-of:${opts.resumeOf}`);

  const unknowns = detectUnknowns(trimmed, kinds);
  if (domainWords(trimmed).length > 0 && operation === "create") {
    for (const w of domainWords(trimmed).slice(0, 3)) {
      // keep high-signal domain words as soft requirements
      if (!explicitRequirements.some((r) => r.includes(w))) explicitRequirements.push(w);
    }
  }

  const intent = ProjectIntent.parse({
    id: opts.id ?? newId("intent"),
    request: trimmed,
    locale,
    operation,
    productKinds: kinds,
    platforms,
    explicitRequirements,
    inferredAssumptions,
    constraints,
    unknowns,
    permissions: opts.permissions ?? [],
    createdAt: nowIso(),
  });
  return intent;
}

export function blockingUnknowns(intent: Intent): Intent["unknowns"] {
  return intent.unknowns.filter((u) => u.impact === "blocking");
}

export function describeIntent(intent: Intent): string {
  return [
    `operation=${intent.operation}`,
    `kinds=${intent.productKinds.join("+")}`,
    `locale=${intent.locale}`,
    `platforms=${intent.platforms.join("+")}`,
    `assumptions=${intent.inferredAssumptions.length}`,
    `unknowns=${intent.unknowns.length}`,
  ].join(" ");
}
