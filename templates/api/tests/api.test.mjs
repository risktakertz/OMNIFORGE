import assert from "node:assert/strict";
import test from "node:test";
import { handle, parseBody } from "../dist/index.js";

test("health endpoint", () => {
  const res = handle("GET", "/health", "");
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "ok");
});

test("items CRUD with validation", () => {
  const bad = handle("POST", "/items", JSON.stringify({ name: "", qty: "x" }));
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error.code, "E_VALIDATION");

  const good = handle("POST", "/items", JSON.stringify({ name: "Widgets", qty: 5 }));
  assert.equal(good.status, 201);

  const list = handle("GET", "/items", "");
  assert.equal(list.json.items.length, 1);
});

test("404 shape", () => {
  const res = handle("GET", "/nope", "");
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, "E_NOT_FOUND");
});

test("parseBody rejects invalid JSON", () => {
  assert.equal(parseBody("{oops").ok, false);
});

test("route matching is exact — query strings ignored", () => {
  assert.equal(handle("GET", "/items?limit=1", "").status, 200);
});
