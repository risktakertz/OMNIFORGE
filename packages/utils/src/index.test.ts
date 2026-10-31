import { describe, it, expect } from "vitest";
import { newId, slugify, redactSecrets, looksLikeSecret, safeJoin, tokenize, wordOverlap, parseArgs } from "./index.js";

describe("utils", () => {
  it("generates unique prefixed ids", () => {
    const a = newId("run");
    const b = newId("run");
    expect(a).toMatch(/^run_[a-f0-9]{20}$/);
    expect(a).not.toBe(b);
  });

  it("slugifies business names", () => {
    expect(slugify("Kali's Salon & Spa!")).toBe("kalis-salon-spa");
    expect(slugify("")).toBe("project");
  });

  it("redacts common secret shapes", () => {
    const text = "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12 and sk-abcdefghij123456789 and Bearer abcdefghijklmnop";
    const red = redactSecrets(text);
    expect(red).not.toContain("ghp_ABCD");
    expect(red).not.toContain("sk-abcdef");
    expect(red).toContain("[REDACTED:");
  });

  it("detects secret-like content", () => {
    expect(looksLikeSecret("api_key = 'supersecretvalue123'")).toBe(true);
    expect(looksLikeSecret("plain text site content")).toBe(false);
  });

  it("blocks path escapes", () => {
    expect(() => safeJoin("/tmp/base", "../escape")).toThrow(/escape/);
    expect(() => safeJoin("/tmp/base", "/etc/passwd")).toThrow(/escape/);
    expect(safeJoin("/tmp/base", "sub/file.txt")).toContain("sub");
  });

  it("tokenizes and scores overlap deterministically", () => {
    expect(tokenize("Build a 2D Racing Game!")).toContain("racing");
    expect(wordOverlap("2d racing game", "2d racing games with phaser")).toBeGreaterThan(0);
    expect(wordOverlap("", "x")).toBe(0);
  });

  it("parses CLI args with --json and values", () => {
    const { positionals, flags } = parseArgs(["plan", "create a site", "--json", "--repo", "/tmp/r"]);
    expect(positionals).toEqual(["plan", "create a site"]);
    expect(flags.json).toBe(true);
    expect(flags.repo).toBe("/tmp/r");
  });
});
