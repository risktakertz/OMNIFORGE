import { searchProducts, filterByCategory, categoriesOf, productById } from "./catalog-logic.js";
import { addToCart, removeFromCart, setQty, cartTotal, cartCount } from "./cart-logic.js";
import { mockCheckout } from "./checkout.js";

const cfg = JSON.parse(document.getElementById("store-config").textContent);

const state = { cart: [], category: "All", query: "" };
const $ = (id) => document.getElementById(id);
const money = (n) => `${cfg.currency ?? "USD"} ${n.toFixed(2)}`;

function persist() {
  localStorage.setItem("of_cart", JSON.stringify(state.cart));
}

function restore() {
  try {
    state.cart = JSON.parse(localStorage.getItem("of_cart") ?? "[]");
  } catch {
    state.cart = [];
  }
}

function renderProducts() {
  const byQuery = searchProducts(cfg.products, state.query);
  const visible = filterByCategory(byQuery, state.category);
  $("empty-state").hidden = visible.length > 0;
  $("product-grid").innerHTML = visible
    .map(
      (p) => `
    <article class="card" data-id="${p.id}">
      <div class="thumb" aria-hidden="true">${p.emoji ?? "\ud83d\uded2"}</div>
      <h3>${p.name}</h3>
      <p class="muted">${p.category}</p>
      <p class="desc">${p.description}</p>
      <p class="price">${money(p.price)}</p>
      <div class="row">
        <button class="btn add" data-id="${p.id}">Add to cart</button>
        <button class="ghost details" data-id="${p.id}">Details</button>
      </div>
    </article>`
    )
    .join("");
}

function renderChips() {
  $("category-chips").innerHTML = categoriesOf(cfg.products)
    .map(
      (c) =>
        `<button class="chip ${c === state.category ? "active" : ""}" data-cat="${c}" ${c === state.category ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${c}</button>`
    )
    .join("");
}

function renderCart() {
  $("cart-count").textContent = String(cartCount(state.cart));
  $("cart-items").innerHTML = state.cart
    .map((line) => {
      const p = productById(cfg.products, line.productId);
      if (!p) return "";
      return `<li><span>${p.emoji ?? ""} ${p.name} × ${line.qty}</span><span>${money(p.price * line.qty)}
        <button class="ghost" data-remove="${p.id}" aria-label="Remove ${p.name}">✕</button>
        <button class="ghost" data-inc="${p.id}" aria-label="Add one ${p.name}">＋</button></span></li>`;
    })
    .join("");
  $("cart-total").textContent = cartTotal(state.cart, cfg.products).toFixed(2);
  $("checkout-btn").disabled = state.cart.length === 0;
  persist();
}

function renderOrders() {
  let orders = [];
  try {
    orders = JSON.parse(localStorage.getItem("of_orders") ?? "[]");
  } catch {
    orders = [];
  }
  $("orders-list").innerHTML =
    orders.length === 0
      ? `<p class="muted">No orders yet — the checkout is a safe mock flow.</p>`
      : orders
          .reverse()
          .map(
            (o) => `<article class="order"><h3>${o.id} <span class="pill">${o.status}</span></h3>
            <p>${o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</p>
            <p><strong>${money(o.total)}</strong> — ${new Date(o.placedAt).toLocaleString()}</p></article>`
          )
          .join("");
}

function openDialog(title, bodyHtml) {
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = bodyHtml;
  $("dialog").hidden = false;
  $("dialog-close").focus();
}

restore();
renderChips();
renderProducts();
renderCart();

document.addEventListener("click", (ev) => {
  const t = ev.target instanceof Element ? ev.target : null;
  if (!t) return;
  const chip = t.closest("[data-cat]");
  if (chip) {
    state.category = chip.getAttribute("data-cat");
    renderChips();
    renderProducts();
    return;
  }
  const add = t.closest("button.add");
  if (add) {
    state.cart = addToCart(state.cart, add.getAttribute("data-id"));
    renderCart();
    return;
  }
  const details = t.closest("button.details");
  if (details) {
    const p = productById(cfg.products, details.getAttribute("data-id"));
    openDialog(p.name, `<p>${p.description}</p><p class="price">${money(p.price)}</p><p class="muted">${p.category}</p>`);
    return;
  }
  const rm = t.closest("[data-remove]");
  if (rm) {
    state.cart = removeFromCart(state.cart, rm.getAttribute("data-remove"));
    renderCart();
    return;
  }
  const inc = t.closest("[data-inc]");
  if (inc) {
    const id = inc.getAttribute("data-inc");
    const line = state.cart.find((l) => l.productId === id);
    state.cart = setQty(state.cart, id, (line?.qty ?? 0) + 1);
    renderCart();
  }
});

$("search").addEventListener("input", (ev) => {
  state.query = ev.target.value;
  renderProducts();
});

$("cart-btn").addEventListener("click", () => {
  $("cart-drawer").hidden = false;
});
$("close-cart").addEventListener("click", () => {
  $("cart-drawer").hidden = true;
});
$("orders-btn").addEventListener("click", () => {
  renderOrders();
  $("orders-view").hidden = false;
  $("product-grid").hidden = true;
  $("category-chips").hidden = true;
  document.querySelector(".tagline").hidden = true;
});
$("close-orders").addEventListener("click", () => {
  $("orders-view").hidden = true;
  $("product-grid").hidden = false;
  $("category-chips").hidden = false;
  document.querySelector(".tagline").hidden = false;
});
$("dialog-close").addEventListener("click", () => {
  $("dialog").hidden = true;
});

$("checkout-btn").addEventListener("click", () => {
  const result = mockCheckout(state.cart, cfg.products, { currency: cfg.currency });
  if (!result.ok) {
    openDialog("Checkout", `<p>Could not check out: ${result.reason}</p>`);
    return;
  }
  const orders = JSON.parse(localStorage.getItem("of_orders") ?? "[]");
  orders.push(result.order);
  localStorage.setItem("of_orders", JSON.stringify(orders));
  state.cart = [];
  renderCart();
  $("cart-drawer").hidden = true;
  openDialog(
    "Order placed (mock)",
    `<p>Order <strong>${result.order.id}</strong> recorded locally with status <span class="pill">${result.order.status}</span>.</p>
     <p>This was a <strong>mock</strong> transaction — nothing was charged. A real payment provider requires explicit approval and credentials.</p>`
  );
});
