/**
 * Original typed API starter (MIT) — zero runtime dependencies.
 * Node's http module + hand-rolled validation keeps the supply chain minimal;
 * swap in Zod when the product grows (see docs/ROADMAP.md).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface Item {
  id: string;
  name: string;
  qty: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

const items: Item[] = [];

export function parseBody(body: string): { ok: true; value: Item } | { ok: false; errors: ValidationError[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, errors: [{ field: "body", message: "invalid JSON" }] };
  }
  const errors: ValidationError[] = [];
  const obj = (raw ?? {}) as Record<string, unknown>;
  const name = obj["name"];
  const qty = obj["qty"];
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 80) {
    errors.push({ field: "name", message: "string of 1..80 required" });
  }
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > 1_000_000) {
    errors.push({ field: "qty", message: "integer 0..1000000 required" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { id: `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, name: (name as string).trim(), qty: qty as number },
  };
}

export function handle(method: string, url: string, body: string): { status: number; json: unknown } {
  const path = url.split("?")[0] ?? "/";
  if (method === "GET" && path === "/health") {
    return { status: 200, json: { status: "ok", service: "sample-api", time: new Date().toISOString() } };
  }
  if (method === "GET" && path === "/items") {
    return { status: 200, json: { items } };
  }
  if (method === "POST" && path === "/items") {
    const parsed = parseBody(body);
    if (!parsed.ok) return { status: 422, json: { error: { code: "E_VALIDATION", details: parsed.errors } } };
    items.push(parsed.value);
    return { status: 201, json: { item: parsed.value } };
  }
  return { status: 404, json: { error: { code: "E_NOT_FOUND", message: `no route for ${method} ${path}` } } };
}

export function createApp(port = 0) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) req.destroy(); // bounded input
    });
    req.on("end", () => {
      const result = handle(req.method ?? "GET", req.url ?? "/", body);
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.json));
    });
  });
  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({ server, url: `http://127.0.0.1:${actual}` });
    });
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const port = Number(process.env.PORT ?? 8787);
  createApp(port).then(({ url }) => console.log(`sample-api listening on ${url}`));
}
