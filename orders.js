/**
 * orders.js — Quản lý đơn hàng thanh toán
 * SQLite, tích hợp với credit.js
 */
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const { getPackageDurationDays } = require("./package_quotas");

const db = new Database(path.join(__dirname, "credit.db"));

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS packages (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    price       INTEGER NOT NULL,
    credit      INTEGER NOT NULL,
    token_quota INTEGER NOT NULL DEFAULT 0,
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
    token_quota   INTEGER NOT NULL DEFAULT 0,
    rpm_limit     INTEGER NOT NULL DEFAULT 10,
    status        TEXT NOT NULL DEFAULT 'pending',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    api_key       TEXT,
    paid_at       TEXT,
    note          TEXT DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_code   ON orders(order_code);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_email  ON orders(customer_email);
  CREATE INDEX IF NOT EXISTS idx_orders_api_key ON orders(api_key);
`);

// Migration: thêm cột expires_at vào orders nếu chưa có
try { db.exec("ALTER TABLE orders ADD COLUMN expires_at TEXT"); } catch (_) {}

// Migration: thêm cột customer_phone nếu chưa có
try { db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE packages ADD COLUMN token_quota INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE orders ADD COLUMN token_quota INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Seed default packages
const seedPkgs = [
  { id: "starter", name: "Starter", price: 20000,  credit: 350,  token_quota: 30000000,  rpm_limit: 10, description: "30,000,000 token, 10 RPM, 1 ngày", active: 1 },
  { id: "pro",     name: "Pro",     price: 270000, credit: 6500, token_quota: 900000000, rpm_limit: 10, description: "900,000,000 token / 30 ngày", active: 1 },
  { id: "pro_v2",  name: "Pro v2",  price: 290000, credit: 9000, token_quota: 900000000, rpm_limit: 10, description: "900,000,000 token / 30 ngày", active: 1 },
  { id: "ultra",   name: "Ultra",   price: 450000, credit: 30000, token_quota: 0,         rpm_limit: 60, description: "30.000 credit (~30M token), 5 API key, 60 RPM", active: 0 },
];
const insertPkg = db.prepare(`
  INSERT OR IGNORE INTO packages (id, name, price, credit, token_quota, rpm_limit, description, active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const p of seedPkgs) insertPkg.run(p.id, p.name, p.price, p.credit, p.token_quota, p.rpm_limit, p.description, p.active);

// Migrate legacy token-only packages once while preserving their existing request quota.
const migrateLegacyPackageQuota = db.prepare("UPDATE packages SET token_quota=? WHERE id=? AND token_quota=0");
for (const p of seedPkgs) {
  if (p.token_quota > 0) migrateLegacyPackageQuota.run(p.token_quota, p.id);
}
db.prepare(`
  UPDATE orders
  SET token_quota = COALESCE((SELECT token_quota FROM packages WHERE packages.id = orders.package_id), 0),
      credit = COALESCE((SELECT credit FROM packages WHERE packages.id = orders.package_id), credit)
  WHERE status = 'pending' AND token_quota = 0
`).run();

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  listPackages:  db.prepare("SELECT * FROM packages WHERE active = 1 ORDER BY price ASC"),
  listAllPackages: db.prepare("SELECT * FROM packages ORDER BY price ASC"),
  getPackage:    db.prepare("SELECT * FROM packages WHERE id = ?"),
  getOrder:      db.prepare("SELECT * FROM orders WHERE id = ?"),
  getOrderCode:  db.prepare("SELECT * FROM orders WHERE order_code = ?"),
  getOrderByApiKey: db.prepare("SELECT * FROM orders WHERE api_key = ? ORDER BY paid_at DESC, created_at DESC LIMIT 1"),
  listOrders:    db.prepare(`
    SELECT *
    FROM orders
    WHERE (? = '' OR customer_name LIKE ? OR order_code LIKE ?)
    ORDER BY created_at DESC
    LIMIT ?
  `),
  listByStatus:  db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC"),
  listByEmail:   db.prepare("SELECT * FROM orders WHERE customer_email = ? ORDER BY created_at DESC"),
  insertOrder:   db.prepare(`INSERT INTO orders (id, order_code, package_id, amount, credit, token_quota, rpm_limit, customer_name, customer_email, customer_phone)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updatePackage: db.prepare("UPDATE packages SET name=?, price=?, credit=?, token_quota=?, rpm_limit=?, description=?, active=? WHERE id=?"),
  setOrderExpiry: db.prepare("UPDATE orders SET expires_at=? WHERE id=?"),
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
function listAllPackages() { return stmts.listAllPackages.all(); }
function getPackage(id) { return stmts.getPackage.get(id); }
function getOrder(id)   { return stmts.getOrder.get(id); }
function getOrderByCode(code) { return stmts.getOrderCode.get(code); }
function getOrderByApiKey(apiKey) { return stmts.getOrderByApiKey.get(apiKey); }
function listOrders(search = "", limit = 100) {
  const normalizedSearch = String(search || "").trim();
  const likeSearch = `%${normalizedSearch}%`;
  return stmts.listOrders.all(normalizedSearch, likeSearch, likeSearch, limit);
}
function listByStatus(status)    { return stmts.listByStatus.all(status); }
function listByEmail(email)      { return stmts.listByEmail.all(email); }

function createOrder({ packageId, customerName, customerEmail, customerPhone }) {
  const pkg = getPackage(packageId);
  if (!pkg) throw new Error(`Package not found: ${packageId}`);
  const id = genOrderId();
  const code = genOrderCode();

  // Tính ngày hết hạn theo giờ Việt Nam để tránh lệch timezone
  let expiresAt = null;
  const days = getPackageDurationDays(packageId);
  if (days) {
    const now = new Date();
    const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    vnNow.setDate(vnNow.getDate() + days);
    const yyyy = vnNow.getFullYear();
    const mm = String(vnNow.getMonth() + 1).padStart(2, "0");
    const dd = String(vnNow.getDate()).padStart(2, "0");
    const hh = String(vnNow.getHours()).padStart(2, "0");
    const mi = String(vnNow.getMinutes()).padStart(2, "0");
    const ss = String(vnNow.getSeconds()).padStart(2, "0");
    expiresAt = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  stmts.insertOrder.run(id, code, pkg.id, pkg.price, pkg.credit, pkg.token_quota || 0, pkg.rpm_limit, customerName || "", customerEmail || "", customerPhone || "");

  if (expiresAt) {
    stmts.setOrderExpiry.run(expiresAt, id);
  }

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

function updatePackage(id, { name, price, requestQuota, tokenQuota, rpmLimit, description, active }) {
  const token_quota = Math.max(0, Math.floor(Number(tokenQuota) || 0));
  const credit = Math.max(0, Math.floor(Number(requestQuota) || 0));
  const rpm_limit = Math.max(1, Math.floor(Number(rpmLimit) || 10));
  const amount = Math.max(0, Math.floor(Number(price) || 0));
  const result = stmts.updatePackage.run(String(name || "").trim(), amount, credit, token_quota, rpm_limit, String(description || "").trim(), active ? 1 : 0, id);
  if (!result.changes) throw new Error(`Package not found: ${id}`);
  return getPackage(id);
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

module.exports = { listPackages, listAllPackages, getPackage, getOrder, getOrderByCode, getOrderByApiKey, listOrders, listByStatus, listByEmail, createOrder, markPaid, markCancelled, cancelExpiredOrders, updatePackage, getStats };
