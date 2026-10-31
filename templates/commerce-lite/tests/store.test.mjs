// Store self-tests: pure logic + rendered output checks.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchProducts, filterByCategory, categoriesOf, productById } from "../dist/catalog-logic.js";
import { addToCart, removeFromCart, setQty, cartTotal, cartCount } from "../dist/cart-logic.js";
import { validateCart, mockCheckout } from "../dist/checkout.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "project.template.json"), "utf8"));
const products = cfg.products;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// catalog
test("search finds products by name", () => {
  const hits = searchProducts(products, "loaf");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "p1");
});
test("search is case-insensitive and covers description", () => {
  assert.ok(searchProducts(products, "SOURDOUGH").length > 0);
});
test("category filter works", () => {
  const pastries = filterByCategory(products, "Pastry");
  assert.ok(pastries.length >= 2 && pastries.every((p) => p.category === "Pastry"));
});
test("categories include All", () => {
  assert.equal(categoriesOf(products)[0], "All");
});
test("productById returns null for unknown", () => {
  assert.equal(productById(products, "nope"), null);
});

// cart
test("cart add/remove/count/total", () => {
  let cart = addToCart([], "p1", 2);
  cart = addToCart(cart, "p2", 1);
  assert.equal(cartCount(cart), 3);
  assert.equal(Math.round(cartTotal(cart, products) * 100) / 100, 11.8);
  cart = removeFromCart(cart, "p1");
  assert.equal(cartTotal(cart, products), 2.8);
  cart = setQty(cart, "p2", 3);
  assert.equal(Math.round(cartTotal(cart, products) * 100) / 100, 8.4);
  cart = setQty(cart, "p2", 0);
  assert.deepEqual(cart, []);
});

// mock checkout
test("empty cart rejected", () => {
  assert.equal(validateCart([], products).ok, false);
});
test("unknown product rejected", () => {
  assert.equal(validateCart([{ productId: "zz", qty: 1 }], products).ok, false);
});
test("mock checkout produces a local mock-paid order (no network)", () => {
  const cart = addToCart(addToCart([], "p1", 2), "p3", 1);
  const res = mockCheckout(cart, products, { idGenerator: () => "ord_test_1", currency: "USD" });
  assert.equal(res.ok, true);
  assert.equal(res.order.mode, "mock");
  assert.equal(res.order.status, "mock-paid");
  assert.equal(res.order.total, 12.2);
  assert.ok(res.order.placedAt);
});
test("checkout source contains no payment endpoints", () => {
  const src = readFileSync(join(ROOT, "dist", "checkout.js"), "utf8");
  assert.match(src, /mock/);
  assert.doesNotMatch(src, /https:\/\/(api|pay|checkout|stripe|paypal)[^"']*/i);
});

// rendered output
test("dist/index.html rendered without tokens, viewport + a11y present", () => {
  const html = readFileSync(join(ROOT, "dist", "index.html"), "utf8");
  assert.ok(existsSync(join(ROOT, "dist", "index.html")), "run npm run generate first");
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /aria-label="Shopping cart"/);
  assert.match(html, /mock/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
}
if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log(`${tests.length} store tests passed`);
