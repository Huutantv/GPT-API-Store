/**
 * credit.js — Hệ thống credit cho Doro Proxy
 * Dùng SQLite (better-sqlite3) để lưu trữ
 *
 * 1 credit = 1K token (input + output cộng lại)
 */

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "credit.db");
const db = new Database(DB_PATH);

// ── Khởi tạo schema ──────────────────────────────────────────────────────────
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS api_keys (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL DEFAULT '',
    credit      INTEGER NOT NULL DEFAULT 0,
    rpm_limit   INTEGER NOT NULL DEFAULT 10,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT,
    active      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS credit_txns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT NOT NULL,
    delta       INTEGER NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    tokens_in   INTEGER NOT NULL DEFAULT 0,
    tokens_out  INTEGER NOT NULL DEFAULT 0,
    model       TEXT NOT NULL DEFAULT '',
    req_id      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_txns_key ON credit_txns(key);
  CREATE INDEX IF NOT EXISTS idx_txns_created ON credit_txns(created_at);

  CREATE TABLE IF NOT EXISTS rpm_buckets (
    key         TEXT NOT NULL,
    minute      TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, minute)
  );
`);

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  getKey:       db.prepare("SELECT * FROM api_keys WHERE key = ?"),
  listKeys:     db.prepare("SELECT key, label, credit, rpm_limit, created_at, expires_at, active FROM api_keys ORDER BY created_at DESC"),
  insertKey:    db.prepare("INSERT INTO api_keys (key, label, credit, rpm_limit, expires_at) VALUES (?, ?, ?, ?, ?)"),
  updateCredit: db.prepare("UPDATE api_keys SET credit = credit + ? WHERE key = ?"),
  setCredit:    db.prepare("UPDATE api_keys SET credit = ? WHERE key = ?"),
  setActive:    db.prepare("UPDATE api_keys SET active = ? WHERE key = ?"),
  deleteKey:    db.prepare("DELETE FROM api_keys WHERE key = ?"),
  insertTxn:    db.prepare("INSERT INTO credit_txns (key, delta, reason, tokens_in, tokens_out, model, req_id) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  getTxns:      db.prepare("SELECT * FROM credit_txns WHERE key = ? ORDER BY created_at DESC LIMIT ?"),
  getAllTxns:   db.prepare("SELECT * FROM credit_txns ORDER BY created_at DESC LIMIT ?"),
  getRpmCount:  db.prepare("SELECT count FROM rpm_buckets WHERE key = ? AND minute = ?"),
  upsertRpm:    db.prepare("INSERT INTO rpm_buckets (key, minute, count) VALUES (?, ?, 1) ON CONFLICT(key, minute) DO UPDATE SET count = count + 1"),
  cleanRpm:     db.prepare("DELETE FROM rpm_buckets WHERE minute < ?"),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tạo API key ngẫu nhiên dạng sk-xxxx...48 ký tự */
function generateKey() {
  return "sk-" + crypto.randomBytes(24).toString("hex");
}

/** Tính credit cần trừ từ token usage (1 credit = 1K token, làm tròn lên) */
function tokensToCredit(tokensIn, tokensOut) {
  const total = (tokensIn || 0) + (tokensOut || 0);
  return Math.max(1, Math.ceil(total / 1000));
}

/** Lấy chuỗi phút hiện tại dạng "YYYY-MM-DD HH:MM" */
function currentMinute() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Kiểm tra key hợp lệ, còn credit, chưa hết hạn, chưa bị khoá
 * @returns {{ ok: boolean, status?: number, message?: string, keyRow?: object }}
 */
function checkCreditAuth(apiKey) {
  if (!apiKey) return { ok: false, status: 401, message: "Missing API key" };

  const row = stmts.getKey.get(apiKey);
  if (!row) return { ok: false, status: 403, message: "Invalid API key" };
  if (!row.active) return { ok: false, status: 403, message: "API key is disabled" };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, status: 403, message: "API key has expired" };
  }
  if (row.credit <= 0) {
    return { ok: false, status: 429, message: "Insufficient credit. Please top up at https://your-domain.com" };
  }
  return { ok: true, keyRow: row };
}

/**
 * Kiểm tra RPM limit
 * @returns {{ ok: boolean, status?: number, message?: string }}
 */
function checkRpm(apiKey, rpmLimit) {
  const minute = currentMinute();
  const row = stmts.getRpmCount.get(apiKey, minute);
  const count = row ? row.count : 0;
  if (count >= rpmLimit) {
    return { ok: false, status: 429, message: `Rate limit exceeded: ${rpmLimit} RPM. Please slow down.` };
  }
  stmts.upsertRpm.run(apiKey, minute);
  // Dọn bucket cũ (giữ 5 phút gần nhất)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
  stmts.cleanRpm.run(fiveMinAgo);
  return { ok: true };
}

/**
 * Trừ credit sau khi request hoàn thành
 * @returns {{ credited: number, remaining: number }}
 */
function deductCredit(apiKey, tokensIn, tokensOut, model, reqId) {
  const cost = tokensToCredit(tokensIn, tokensOut);
  stmts.updateCredit.run(-cost, apiKey);
  stmts.insertTxn.run(apiKey, -cost, "usage", tokensIn || 0, tokensOut || 0, model || "", reqId || "");
  const row = stmts.getKey.get(apiKey);
  return { credited: cost, remaining: row ? row.credit : 0 };
}

/**
 * Nạp credit cho key
 */
function topupCredit(apiKey, amount, reason = "topup") {
  const row = stmts.getKey.get(apiKey);
  if (!row) throw new Error("Key not found");
  stmts.updateCredit.run(amount, apiKey);
  stmts.insertTxn.run(apiKey, amount, reason, 0, 0, "", "");
  const updated = stmts.getKey.get(apiKey);
  return { key: apiKey, credit: updated.credit };
}

/**
 * Tạo key mới
 */
function createKey({ label = "", credit = 0, rpmLimit = 10, expiresAt = null } = {}) {
  const key = generateKey();
  stmts.insertKey.run(key, label, credit, rpmLimit, expiresAt);
  if (credit > 0) {
    stmts.insertTxn.run(key, credit, "initial", 0, 0, "", "");
  }
  return stmts.getKey.get(key);
}

/**
 * Xoá key
 */
function deleteKey(apiKey) {
  const row = stmts.getKey.get(apiKey);
  if (!row) throw new Error("Key not found");
  stmts.deleteKey.run(apiKey);
  return { removed: apiKey };
}

/**
 * Khoá / mở khoá key
 */
function setKeyActive(apiKey, active) {
  stmts.setActive.run(active ? 1 : 0, apiKey);
}

/**
 * Lấy thông tin key
 */
function getKey(apiKey) {
  return stmts.getKey.get(apiKey);
}

/**
 * Danh sách tất cả keys
 */
function listKeys() {
  return stmts.listKeys.all();
}

/**
 * Lịch sử giao dịch của key
 */
function getHistory(apiKey, limit = 50) {
  return stmts.getTxns.all(apiKey, limit);
}

/**
 * Lịch sử tất cả giao dịch (admin)
 */
function getAllHistory(limit = 200) {
  return stmts.getAllTxns.all(limit);
}

/**
 * Thống kê tổng quan
 */
function getStats() {
  const keys = db.prepare("SELECT COUNT(*) as total, SUM(credit) as total_credit, SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) as active_keys FROM api_keys").get();
  const txns = db.prepare("SELECT COUNT(*) as total_txns, SUM(CASE WHEN delta < 0 THEN ABS(delta) ELSE 0 END) as total_spent FROM credit_txns").get();
  return { ...keys, ...txns };
}

module.exports = {
  generateKey,
  tokensToCredit,
  checkCreditAuth,
  checkRpm,
  deductCredit,
  topupCredit,
  createKey,
  deleteKey,
  setKeyActive,
  getKey,
  listKeys,
  getHistory,
  getAllHistory,
  getStats,
};
