/**
 * orders.js — Quản lý đơn hàng thanh toán
 * SQLite, tích hợp với credit.js
 */
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const db = new Database(path.join(__dirname, "credit.db"));

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS packages (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    price       INTEGER NOT NULL,
    credit      INTEGER NOT NULL,
    rpm_limit   INTEGER NOT NULL DEFAULT 10,
    description TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    order_code    TEXT NOT NULL UNIQUE,
    package_id    TEXT NOT NULL,
    amount        INTEGER NOT NULL,
    credit        INTEGER NOT NULL,
    rpm_limit     INTEGER NOT NULL DEFAULT 10,
    status        TEXT NOT NULL DEFAULT 'pending',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    api_key       TEXT,
    paid_at       TEXT,
    note          TEXT DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_code   ON orders(order_code);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_email  ON orders(customer_email);
`);

// ── Seed default packages ─────────────────────────────────────────────────────
const seedPkgs = [
  { id: "starter", name: "Starter", price: 30000,  credit: 200,   rpm_limit: 60, description: "200 credit (200 requests), 60 RPM", active: 1 },
  { id: "pro",     name: "Pro",     price: 199000, credit: 10000, rpm_limit: 30, description: "10.000 credit (~10M token), 3 API key, 30 RPM", active: 0 },
  { id: "ultra",   name: "Ultra",   price: 299000, credit: 30000, rpm_limit: 60, description: "30.000 credit (~30M token), 5 API key, 60 RPM", active: 0 },
];
const insertPkg = db.prepare(`
  INSERT OR IGNORE INTO packages (id, name, price, credit, rpm_limit, description, active)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
for (const p of seedPkgs) insertPkg.run(p.id, p.name, p.price, p.credit, p.rpm_limit, p.description, p.active);

// Cập nhật packages đã tồn tại
const updatePkg = db.prepare("UPDATE packages SET price=?, credit=?, description=?, active=? WHERE id=?");
updatePkg.run(30000,  200,   "200 credit (200 requests), 60 RPM",              1, "starter");
updatePkg.run(199000, 10000, "10.000 credit (~10M token), 3 API key, 30 RPM",   0, "pro");
updatePkg.run(299000, 30000, "30.000 credit (~30M token), 5 API key, 60 RPM",   0, "ultra");

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  listPackages:  db.prepare("SELECT * FROM packages WHERE active = 1 ORDER BY price ASC"),
  getPackage:    db.prepare("SELECT * FROM packages WHERE id = ?"),
  getOrder:      db.prepare("SELECT * FROM orders WHERE id = ?"),
  getOrderCode:  db.prepare("SELECT * FROM orders WHERE order_code = ?"),
  listOrders:    db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?"),
  listByStatus:  db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC"),
  listByEmail:   db.prepare("SELECT * FROM orders WHERE customer_email = ? ORDER BY created_at DESC"),
  insertOrder:   db.prepare(`INSERT INTO orders (id, order_code, package_id, amount, credit, rpm_limit, customer_name, customer_email)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  markPaid:      db.prepare("UPDATE orders SET status='paid', api_key=?, paid_at=datetime('now'), note=? WHERE id=?"),
  markCancelled: db.prepare("UPDATE orders SET status='cancelled' WHERE id=?"),
  countByStatus: db.prepare("SELECT status, COUNT(*) as cnt FROM orders GROUP BY status"),
  revenueTotal:  db.prepare("SELECT SUM(amount) as total FROM orders WHERE status='paid'"),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function genOrderId()   { return crypto.randomBytes(8).toString("hex").toUpperCase(); }
function genOrderCode() { return "GPT" + Date.now().toString(36).toUpperCase().slice(-6); }

// ── Public API ────────────────────────────────────────────────────────────────
function listPackages() { return stmts.listPackages.all(); }
function getPackage(id) { return stmts.getPackage.get(id); }
function getOrder(id)   { return stmts.getOrder.get(id); }
function getOrderByCode(code) { return stmts.getOrderCode.get(code); }
function listOrders(limit = 100) { return stmts.listOrders.all(limit); }
function listByStatus(status)    { return stmts.listByStatus.all(status); }
function listByEmail(email)      { return stmts.listByEmail.all(email); }

function createOrder({ packageId, customerName, customerEmail }) {
  const pkg = getPackage(packageId);
  if (!pkg) throw new Error(`Package not found: ${packageId}`);
  const id = genOrderId();
  const code = genOrderCode();
  stmts.insertOrder.run(id, code, pkg.id, pkg.price, pkg.credit, pkg.rpm_limit, customerName || "", customerEmail || "");
  return getOrder(id);
}

function markPaid(orderId, apiKey, note = "") {
  stmts.markPaid.run(apiKey, note, orderId);
  return getOrder(orderId);
}

function markCancelled(orderId) {
  stmts.markCancelled.run(orderId);
}

function cancelExpiredOrders() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const result = db.prepare("UPDATE orders SET status='cancelled' WHERE status='pending' AND created_at < ?").run(cutoff);
  return result.changes;
}

function getStats() {
  const counts = {};
  for (const row of stmts.countByStatus.all()) counts[row.status] = row.cnt;
  const rev = stmts.revenueTotal.get();
  return {
    pending:   counts.pending   || 0,
    paid:      counts.paid      || 0,
    cancelled: counts.cancelled || 0,
    total_orders: Object.values(counts).reduce((a, b) => a + b, 0),
    revenue: rev.total || 0,
  };
}

module.exports = { listPackages, getPackage, getOrder, getOrderByCode, listOrders, listByStatus, listByEmail, createOrder, markPaid, markCancelled, cancelExpiredOrders, getStats };
