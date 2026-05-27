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
    key            TEXT PRIMARY KEY,
    label          TEXT NOT NULL DEFAULT '',
    credit         INTEGER NOT NULL DEFAULT 0,
    rpm_limit      INTEGER NOT NULL DEFAULT 10,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at     TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    token_remaining INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS token_daily_usage (
    key         TEXT NOT NULL,
    day         TEXT NOT NULL,
    tokens      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, day)
  );
`);

// Migration: thêm cột token_remaining nếu chưa có
try { db.exec("ALTER TABLE api_keys ADD COLUMN token_remaining INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  getKey:       db.prepare("SELECT * FROM api_keys WHERE key = ?"),
  listKeys:     db.prepare("SELECT key, label, credit, rpm_limit, created_at, expires_at, active, token_remaining FROM api_keys ORDER BY created_at DESC"),
  insertKey:    db.prepare("INSERT INTO api_keys (key, label, credit, rpm_limit, expires_at, token_remaining) VALUES (?, ?, ?, ?, ?, ?)"),
  updateCredit: db.prepare("UPDATE api_keys SET credit = credit + ? WHERE key = ?"),
  setCredit:    db.prepare("UPDATE api_keys SET credit = ? WHERE key = ?"),
  setActive:    db.prepare("UPDATE api_keys SET active = ? WHERE key = ?"),
  deleteKey:    db.prepare("DELETE FROM api_keys WHERE key = ?"),
  insertTxn:    db.prepare("INSERT INTO credit_txns (key, delta, reason, tokens_in, tokens_out, model, req_id) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  getTxns:      db.prepare("SELECT * FROM credit_txns WHERE key = ? ORDER BY created_at DESC LIMIT ?"),
  getUsageTotal: db.prepare("SELECT COALESCE(SUM(ABS(delta)), 0) AS total_spent, COUNT(*) AS usage_count FROM credit_txns WHERE key = ? AND delta < 0"),
  getAllTxns:   db.prepare("SELECT * FROM credit_txns ORDER BY created_at DESC LIMIT ?"),
  getRpmCount:  db.prepare("SELECT count FROM rpm_buckets WHERE key = ? AND minute = ?"),
  upsertRpm:    db.prepare("INSERT INTO rpm_buckets (key, minute, count) VALUES (?, ?, 1) ON CONFLICT(key, minute) DO UPDATE SET count = count + 1"),
  cleanRpm:     db.prepare("DELETE FROM rpm_buckets WHERE minute < ?"),
  getDailyUsage: db.prepare("SELECT tokens FROM token_daily_usage WHERE key = ? AND day = ?"),
  upsertDailyUsage: db.prepare("INSERT INTO token_daily_usage (key, day, tokens) VALUES (?, ?, ?) ON CONFLICT(key, day) DO UPDATE SET tokens = tokens + excluded.tokens"),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tạo API key ngẫu nhiên dạng sk-xxxx...48 ký tự */
function generateKey() {
  return "sk-" + crypto.randomBytes(24).toString("hex");
}

/**
 * Tính credit cần trừ theo token
 * Rule: 1 credit = 1K token (input + output cộng lại)
 * Trừ: ceil((tokensIn + tokensOut) / 1000), tối thiểu 1 credit nếu có usage
 */
function tokensToCredit(tokensIn, tokensOut) {
  const total = Math.max(0, Number(tokensIn || 0) + Number(tokensOut || 0));
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / 1000));
}

/** Lấy chuỗi phút hiện tại dạng "YYYY-MM-DD HH:MM" */
function currentMinute() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** Lấy ngày hiện tại theo giờ Việt Nam dạng YYYY-MM-DD */
function currentVNDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function getDailyTokenUsed(apiKey) {
  const row = stmts.getDailyUsage.get(apiKey, currentVNDay());
  return Number(row ? row.tokens : 0);
}

const PACKAGE_TOKEN_QUOTAS = {
  starter: 30000000,
  pro: 900000000,
  pro_v2: 900000000,
};

function getPackageIdFromLabel(row) {
  const label = String((row && row.label) || "").toLowerCase();
  const match = label.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : "";
}

function getQuotaTokenLimit(row) {
  return PACKAGE_TOKEN_QUOTAS[getPackageIdFromLabel(row)] || 0;
}

function getTokenPerRequest() {
  return Math.max(1, Number(process.env.DORO_TOKEN_PER_REQUEST || process.env.DORO_TOKEN_PER_REQUEST_MIN || 85000));
}

function inferQuotaTokenRemaining(row) {
  const tokenRemaining = Math.max(0, Number((row && row.token_remaining) || 0));
  if (tokenRemaining > 0) return tokenRemaining;

  const packageTokenQuota = getQuotaTokenLimit(row);
  const creditRemaining = Math.max(0, Number((row && row.credit) || 0));
  if (!packageTokenQuota || !creditRemaining) return 0;

  return Math.min(packageTokenQuota, creditRemaining * getTokenPerRequest());
}

function isQuotaKey(row) {
  return getQuotaTokenLimit(row) > 0;
}

function isDailyLimitedQuotaKey(row) {
  return getPackageIdFromLabel(row) === "pro";
}

// ── Public API ────────────────────────────────────────────────────────────────

function parseExpiryTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // DB lưu expires_at dạng giờ Việt Nam: YYYY-MM-DD HH:mm:ss.
  // Convert rõ ràng sang ISO +07:00 để không bị Node/VPS hiểu nhầm là UTC/local timezone khác.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + "T23:59:59+07:00");
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    const normalized = raw.replace(" ", "T");
    return new Date((normalized.length === 16 ? normalized + ":00" : normalized) + "+07:00");
  }
  return new Date(raw);
}

/**
 * Kiểm tra key hợp lệ, còn credit, chưa hết hạn, chưa bị khoá
 * @returns {{ ok: boolean, status?: number, message?: string, keyRow?: object }}
 */
function checkCreditAuth(apiKey) {
  if (!apiKey) return { ok: false, status: 401, message: "Missing API key" };

  const row = stmts.getKey.get(apiKey);
  if (!row) return { ok: false, status: 403, message: "Invalid API key" };
  if (!row.active) return { ok: false, status: 403, message: "API key is disabled" };
  const expiresAt = parseExpiryTime(row.expires_at);
  if (expiresAt && expiresAt < new Date()) {
    return { ok: false, status: 403, message: "API key has expired" };
  }
  if (row.credit <= 0) {
    return { ok: false, status: 429, message: `Insufficient credit. Please top up at ${process.env.DORO_PUBLIC_URL || "https://zplay.io.vn"}` };
  }
  if (isDailyLimitedQuotaKey(row) && getDailyTokenUsed(apiKey) >= 30000000) {
    return { ok: false, status: 429, message: "Daily token limit reached: 30M tokens. Please try again tomorrow." };
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
  // Default: token-based (real usage)
  let cost = tokensToCredit(tokensIn, tokensOut);
  let tIn = Number(tokensIn || 0);
  let tOut = Number(tokensOut || 0);

  const rowBefore = stmts.getKey.get(apiKey);

  // Quota package mode: credit = request quota, token_remaining = synthetic token quota.
  // Old keys may have token_remaining=0, so infer remaining quota from current request credit.
  const inferredTokenRemaining = inferQuotaTokenRemaining(rowBefore);
  if (rowBefore && isQuotaKey(rowBefore) && inferredTokenRemaining > 0) {
    cost = 1; // 1 request

    const reqRemaining = Math.max(0, Number(rowBefore.credit || 0));
    const tokenRemaining = inferredTokenRemaining;
    const dailyRemaining = isDailyLimitedQuotaKey(rowBefore)
      ? Math.max(0, 30000000 - getDailyTokenUsed(apiKey))
      : tokenRemaining;

    const totalTokens = tokenRemaining;

    const configuredPerRequest = getTokenPerRequest();
    const minPerRequest = Math.max(1, Math.floor(configuredPerRequest * 0.8));
    const maxPerRequest = Math.max(minPerRequest, Math.ceil(configuredPerRequest * 1.2));
    const remainingRequestsAfterThis = Math.max(0, reqRemaining - 1);

    // Mỗi request hiển thị ngẫu nhiên trong khoảng setup ±20%.
    // Đồng thời vẫn giữ invariant: dùng đủ số request đã setup thì token_remaining về đúng 0.
    let low = Math.max(1, minPerRequest, totalTokens - (remainingRequestsAfterThis * maxPerRequest));
    let high = Math.min(maxPerRequest, totalTokens - (remainingRequestsAfterThis * minPerRequest));
    if (dailyRemaining > 0) high = Math.min(high, dailyRemaining);

    let shownTotal;
    if (reqRemaining <= 1) {
      shownTotal = Math.min(totalTokens, dailyRemaining || totalTokens);
    } else if (low <= high) {
      shownTotal = crypto.randomInt(low, high + 1);
    } else {
      shownTotal = Math.min(configuredPerRequest, totalTokens, dailyRemaining || totalTokens);
    }

    // Phân tách token in/out để lịch sử vẫn dễ đọc nhưng tổng luôn cố định theo setting.
    const minIn = Math.max(1, Math.floor(shownTotal * 0.25));
    const maxIn = Math.max(minIn, shownTotal - 1);
    tIn = shownTotal <= 1 ? shownTotal : crypto.randomInt(minIn, maxIn + 1);
    tOut = Math.max(0, shownTotal - tIn);

    // Update token_remaining theo quota thật. Với key cũ chưa có token_remaining,
    // set thẳng về phần còn lại đã suy ra để các request sau tiếp tục random đúng mode quota.
    if (Number(rowBefore.token_remaining || 0) > 0) {
      db.prepare("UPDATE api_keys SET token_remaining = MAX(0, token_remaining - ?) WHERE key = ?").run(shownTotal, apiKey);
    } else {
      db.prepare("UPDATE api_keys SET token_remaining = ? WHERE key = ?").run(Math.max(0, tokenRemaining - shownTotal), apiKey);
    }
    if (isDailyLimitedQuotaKey(rowBefore)) stmts.upsertDailyUsage.run(apiKey, currentVNDay(), shownTotal);
  }

  stmts.updateCredit.run(-cost, apiKey);
  stmts.insertTxn.run(apiKey, -cost, "usage", tIn || 0, tOut || 0, model || "", reqId || "");
  const row = stmts.getKey.get(apiKey);

  // Khi hết request quota: ép token_remaining về 0 (không để dư)
  if (row && row.credit <= 0 && row.token_remaining > 0) {
    db.prepare("UPDATE api_keys SET token_remaining = 0 WHERE key = ?").run(apiKey);
  }

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
function createKey({ label = "", credit = 0, rpmLimit = 10, expiresAt = null, tokenRemaining = 0 } = {}) {
  const key = generateKey();
  stmts.insertKey.run(key, label, credit, rpmLimit, expiresAt, Number(tokenRemaining || 0));
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
 * Tổng credit đã sử dụng của key
 */
function getUsageTotal(apiKey) {
  return stmts.getUsageTotal.get(apiKey) || { total_spent: 0, usage_count: 0 };
}

function getDailyQuota(apiKey) {
  const row = stmts.getKey.get(apiKey);
  if (!isDailyLimitedQuotaKey(row)) return null;
  const used = getDailyTokenUsed(apiKey);
  const limit = 30000000;
  return { day: currentVNDay(), used, limit, remaining: Math.max(0, limit - used) };
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
  getUsageTotal,
  getAllHistory,
  getDailyQuota,
  getStats,
  parseExpiryTime,
};
