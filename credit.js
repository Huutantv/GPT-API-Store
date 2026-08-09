/**
 * credit.js — Hệ thống credit cho Doro Proxy
 * Dùng SQLite (better-sqlite3) để lưu trữ
 *
 * 1 credit = 1K token (input + output cộng lại)
 */

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const {
  getTokenPerRequest,
} = require("./package_quotas");

const DB_PATH = process.env.DORO_DB_PATH
  ? path.resolve(process.env.DORO_DB_PATH)
  : path.join(__dirname, "credit.db");
const db = new Database(DB_PATH);

// ── Khởi tạo schema ──────────────────────────────────────────────────────────
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS api_keys (
    key            TEXT PRIMARY KEY,
    label          TEXT NOT NULL DEFAULT '',
    credit         INTEGER NOT NULL DEFAULT 0,
    rpm_limit      INTEGER NOT NULL DEFAULT 30,
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

  CREATE TABLE IF NOT EXISTS request_reservations (
    req_id          TEXT PRIMARY KEY,
    key             TEXT NOT NULL,
    model           TEXT NOT NULL DEFAULT '',
    state           TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'refunded')),
    quota_mode      INTEGER NOT NULL DEFAULT 0,
    token_debit     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_request_reservations_key_state
    ON request_reservations(key, state);
`);

// Migration: thêm cột token_remaining nếu chưa có
try { db.exec("ALTER TABLE api_keys ADD COLUMN token_remaining INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Migration: thêm cột duration_days và first_used_at
try { db.exec("ALTER TABLE api_keys ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE api_keys ADD COLUMN first_used_at TEXT"); } catch (_) {}

// Đồng bộ toàn bộ key hiện có với chính sách RPM hiện tại.
db.exec("UPDATE api_keys SET rpm_limit = 30");

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  getKey:       db.prepare("SELECT * FROM api_keys WHERE key = ?"),
  listKeys:     db.prepare("SELECT key, label, credit, rpm_limit, created_at, expires_at, active, token_remaining, duration_days, first_used_at FROM api_keys ORDER BY created_at DESC"),
  insertKey:    db.prepare("INSERT INTO api_keys (key, label, credit, rpm_limit, expires_at, token_remaining, duration_days) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  updateCredit: db.prepare("UPDATE api_keys SET credit = credit + ? WHERE key = ?"),
  updateTokenRemaining: db.prepare("UPDATE api_keys SET token_remaining = token_remaining + ? WHERE key = ?"),
  setCredit:    db.prepare("UPDATE api_keys SET credit = ? WHERE key = ?"),
  setTokenRemaining: db.prepare("UPDATE api_keys SET token_remaining = ? WHERE key = ?"),
  setExpiry:    db.prepare("UPDATE api_keys SET expires_at = ?, duration_days = 0 WHERE key = ?"),
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
  getReservation: db.prepare("SELECT * FROM request_reservations WHERE req_id = ?"),
  insertReservation: db.prepare("INSERT INTO request_reservations (req_id, key, model, state, quota_mode) VALUES (?, ?, ?, 'reserved', ?)"),
  countPendingReservations: db.prepare("SELECT COUNT(*) AS count FROM request_reservations WHERE key = ? AND state = 'reserved'"),
  settleReservation: db.prepare("UPDATE request_reservations SET state = 'settled', token_debit = ?, completed_at = datetime('now') WHERE req_id = ? AND state = 'reserved'"),
  refundReservation: db.prepare("UPDATE request_reservations SET state = 'refunded', completed_at = datetime('now') WHERE req_id = ? AND state = 'reserved'"),
  reserveCredit: db.prepare("UPDATE api_keys SET credit = credit - 1 WHERE key = ? AND credit > 0"),
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

function getPackageIdFromLabel(row) {
  const label = String((row && row.label) || "").toLowerCase();
  const match = label.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : "";
}

function inferQuotaTokenRemaining(row) {
  const tokenRemaining = Math.max(0, Number((row && row.token_remaining) || 0));
  return tokenRemaining;
}

function isQuotaKey(row) {
  return Number((row && row.token_remaining) || 0) > 0;
}

function isDailyLimitedQuotaKey(row) {
  return false;
}

function getQuotaInfo(row) {
  return {
    package_id: getPackageIdFromLabel(row),
    token_quota: Math.max(0, Number((row && row.token_remaining) || 0)),
    token_per_request: getTokenPerRequest(),
    token_remaining: inferQuotaTokenRemaining(row),
  };
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

  // Kích hoạt first-use: nếu key có duration_days nhưng chưa có expires_at và chưa dùng lần nào
  if (Number(row.duration_days || 0) > 0 && !row.expires_at) {
    const now = new Date();
    const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    vnNow.setDate(vnNow.getDate() + Number(row.duration_days));
    const yyyy = vnNow.getFullYear();
    const mm = String(vnNow.getMonth() + 1).padStart(2, "0");
    const dd = String(vnNow.getDate()).padStart(2, "0");
    const hh = String(vnNow.getHours()).padStart(2, "0");
    const mi = String(vnNow.getMinutes()).padStart(2, "0");
    const ss = String(vnNow.getSeconds()).padStart(2, "0");
    const newExpiresAt = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    db.prepare("UPDATE api_keys SET expires_at = ?, first_used_at = datetime('now') WHERE key = ?").run(newExpiresAt, apiKey);
    row.expires_at = newExpiresAt;
    row.first_used_at = new Date().toISOString();
  }

  const expiresAt = parseExpiryTime(row.expires_at);
  if (expiresAt && expiresAt < new Date()) {
    return {
      ok: false,
      status: 403,
      message: "API key has expired",
      code: "api_key_expired",
      keyRow: row,
      details: {
        expired_at: row.expires_at || null,
        expired_at_iso: Number.isNaN(expiresAt.getTime()) ? null : expiresAt.toISOString(),
      },
    };
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

function reservationError(status, message, code) {
  return { ok: false, status, message, ...(code ? { code } : {}) };
}

function validateReservableKey(row) {
  if (!row) return reservationError(403, "Invalid API key");
  if (!row.active) return reservationError(403, "API key is disabled");
  const expiresAt = parseExpiryTime(row.expires_at);
  if (expiresAt && expiresAt < new Date()) {
    return reservationError(403, "API key has expired", "api_key_expired");
  }
  if (Number(row.credit || 0) <= 0) {
    return reservationError(429, `Insufficient credit. Please top up at ${process.env.DORO_PUBLIC_URL || "https://zplay.io.vn"}`, "insufficient_credit");
  }
  if (isDailyLimitedQuotaKey(row) && getDailyTokenUsed(row.key) >= 30000000) {
    return reservationError(429, "Daily token limit reached: 30M tokens. Please try again tomorrow.", "daily_token_limit");
  }
  return { ok: true };
}

const reserveRequestTransaction = db.transaction((apiKey, reqId, model) => {
  const existing = stmts.getReservation.get(reqId);
  if (existing) {
    if (existing.key !== apiKey) return reservationError(409, "Request ID is already assigned to another API key", "duplicate_request_id");
    if (existing.state === "refunded") return reservationError(409, "Request reservation was already refunded", "reservation_refunded");
    return { ok: true, reservation: existing, duplicate: true };
  }

  const row = stmts.getKey.get(apiKey);
  const validity = validateReservableKey(row);
  if (!validity.ok) return validity;

  const minute = currentMinute();
  const rpm = stmts.getRpmCount.get(apiKey, minute);
  const rpmLimit = Math.max(1, Number(row.rpm_limit || 30));
  if (Number((rpm && rpm.count) || 0) >= rpmLimit) {
    return reservationError(429, `Rate limit exceeded: ${rpmLimit} RPM. Please slow down.`, "rate_limit_exceeded");
  }

  const reserved = stmts.reserveCredit.run(apiKey);
  if (reserved.changes !== 1) {
    return reservationError(429, `Insufficient credit. Please top up at ${process.env.DORO_PUBLIC_URL || "https://zplay.io.vn"}`, "insufficient_credit");
  }
  stmts.upsertRpm.run(apiKey, minute);
  stmts.insertReservation.run(reqId, apiKey, String(model || ""), isQuotaKey(row) ? 1 : 0);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
  stmts.cleanRpm.run(fiveMinAgo);
  return { ok: true, reservation: stmts.getReservation.get(reqId), remaining: Number(row.credit) - 1 };
});

function reserveRequest(apiKey, reqId, model = "") {
  const key = String(apiKey || "").trim();
  const id = String(reqId || "").trim();
  if (!key) return reservationError(401, "Missing API key");
  if (!id) return reservationError(400, "Missing request ID", "missing_request_id");
  return reserveRequestTransaction.immediate(key, id, model);
}

const settleRequestTransaction = db.transaction((reqId, tokensIn, tokensOut, model) => {
  const reservation = stmts.getReservation.get(reqId);
  if (!reservation) return { ok: false, state: "missing" };
  if (reservation.state !== "reserved") return { ok: reservation.state === "settled", state: reservation.state, duplicate: true };

  const row = stmts.getKey.get(reservation.key);
  if (!row) {
    stmts.refundReservation.run(reqId);
    return { ok: false, state: "refunded", message: "API key no longer exists" };
  }

  let cost = tokensToCredit(tokensIn, tokensOut);
  let tIn = Math.max(0, Number(tokensIn || 0));
  let tOut = Math.max(0, Number(tokensOut || 0));
  let tokenDebit = 0;

  if (reservation.quota_mode) {
    cost = 1;
    const tokenRemaining = Math.max(0, Number(row.token_remaining || 0));
    const pending = Number(stmts.countPendingReservations.get(reservation.key).count || 0);
    const requestShares = Math.max(1, Number(row.credit || 0) + pending);
    if (tokenRemaining > 0) {
      const target = Math.max(1, Math.floor(tokenRemaining / requestShares));
      const min = Math.max(1, Math.floor(target * 0.8));
      const max = Math.max(min, Math.ceil(target * 1.2));
      const remainingShares = Math.max(0, requestShares - 1);
      const low = Math.max(1, min, tokenRemaining - (remainingShares * max));
      const high = Math.min(max, tokenRemaining - (remainingShares * min));
      tokenDebit = requestShares <= 1
        ? tokenRemaining
        : (low <= high ? crypto.randomInt(low, high + 1) : Math.min(target, tokenRemaining));
      const minIn = Math.max(1, Math.floor(tokenDebit * 0.25));
      const maxIn = Math.max(minIn, tokenDebit - 1);
      tIn = tokenDebit <= 1 ? tokenDebit : crypto.randomInt(minIn, maxIn + 1);
      tOut = Math.max(0, tokenDebit - tIn);
      stmts.setTokenRemaining.run(Math.max(0, tokenRemaining - tokenDebit), reservation.key);
      if (isDailyLimitedQuotaKey(row)) stmts.upsertDailyUsage.run(reservation.key, currentVNDay(), tokenDebit);
    } else {
      tIn = 0;
      tOut = 0;
    }
  } else {
    const additionalCost = Math.max(0, cost - 1);
    if (additionalCost > 0) {
      db.prepare("UPDATE api_keys SET credit = MAX(0, credit - ?) WHERE key = ?").run(additionalCost, reservation.key);
    }
  }

  stmts.insertTxn.run(reservation.key, -cost, "usage", tIn, tOut, model || reservation.model || "", reqId);
  stmts.settleReservation.run(tokenDebit, reqId);
  const updated = stmts.getKey.get(reservation.key);
  return { ok: true, state: "settled", credited: cost, remaining: updated ? updated.credit : 0, token_remaining: updated ? updated.token_remaining : 0 };
});

function settleRequest(reqId, tokensIn, tokensOut, model = "") {
  const id = String(reqId || "").trim();
  if (!id) return { ok: false, state: "missing" };
  return settleRequestTransaction.immediate(id, tokensIn, tokensOut, model);
}

const refundRequestTransaction = db.transaction((reqId) => {
  const reservation = stmts.getReservation.get(reqId);
  if (!reservation) return { ok: false, state: "missing" };
  if (reservation.state !== "reserved") return { ok: true, state: reservation.state, duplicate: true };
  const updated = stmts.refundReservation.run(reqId);
  if (updated.changes === 1 && stmts.getKey.get(reservation.key)) stmts.updateCredit.run(1, reservation.key);
  return { ok: true, state: "refunded" };
});

function refundRequest(reqId) {
  const id = String(reqId || "").trim();
  if (!id) return { ok: false, state: "missing" };
  return refundRequestTransaction.immediate(id);
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
  const quotaMode = rowBefore && isQuotaKey(rowBefore) && inferredTokenRemaining > 0;
  if (quotaMode) {
    cost = 1; // 1 request

    const reqRemaining = Math.max(0, Number(rowBefore.credit || 0));
    const tokenRemaining = inferredTokenRemaining;
    const dailyRemaining = isDailyLimitedQuotaKey(rowBefore)
      ? Math.max(0, 30000000 - getDailyTokenUsed(apiKey))
      : tokenRemaining;

    const totalTokens = tokenRemaining;

    // Each package owns independent request and token totals. Derive the per-call
    // display amount from its remaining balance so both quotas reach zero together.
    const targetPerRequest = Math.max(1, Math.floor(totalTokens / Math.max(1, reqRemaining)));
    const minPerRequest = Math.max(1, Math.floor(targetPerRequest * 0.8));
    const maxPerRequest = Math.max(minPerRequest, Math.ceil(targetPerRequest * 1.2));
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
      shownTotal = Math.min(targetPerRequest, totalTokens, dailyRemaining || totalTokens);
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

  if (row && quotaMode && Number(row.token_remaining || 0) <= 0) {
    db.prepare("UPDATE api_keys SET credit = 0 WHERE key = ?").run(apiKey);
    row.credit = 0;
  }

  // Khi hết request quota: ép token_remaining về 0 (không để dư)
  if (row && row.credit <= 0 && row.token_remaining > 0) {
    db.prepare("UPDATE api_keys SET token_remaining = 0 WHERE key = ?").run(apiKey);
  }

  return { credited: cost, remaining: row ? row.credit : 0 };
}

/**
 * Nạp credit cho key
 */
function topupCredit(apiKey, amount, reason = "topup", tokenAmount = 0) {
  const row = stmts.getKey.get(apiKey);
  if (!row) throw new Error("Key not found");
  stmts.updateCredit.run(amount, apiKey);
  const tokens = Math.max(0, Number(tokenAmount || 0));
  if (tokens > 0) stmts.updateTokenRemaining.run(tokens, apiKey);
  stmts.insertTxn.run(apiKey, amount, reason, 0, 0, "", "");
  const updated = stmts.getKey.get(apiKey);
  return { key: apiKey, credit: updated.credit, token_remaining: updated.token_remaining };
}

function adjustCredit(apiKey, delta, reason = "admin_adjustment") {
  const amount = Math.trunc(Number(delta));
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("Credit adjustment must be a non-zero integer");

  const adjust = db.transaction(() => {
    const row = stmts.getKey.get(apiKey);
    if (!row) throw new Error("Key not found");
    const nextCredit = Number(row.credit || 0) + amount;
    if (nextCredit < 0) throw new Error("Credit cannot be reduced below zero");
    stmts.setCredit.run(nextCredit, apiKey);
    stmts.insertTxn.run(apiKey, amount, reason, 0, 0, "", "");
    return stmts.getKey.get(apiKey);
  });

  const updated = adjust();
  return { key: apiKey, delta: amount, credit: updated.credit, token_remaining: updated.token_remaining };
}

function adjustToken(apiKey, delta, reason = "admin_token_adjustment") {
  const amount = Math.trunc(Number(delta));
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("Token adjustment must be a non-zero integer");

  const adjust = db.transaction(() => {
    const row = stmts.getKey.get(apiKey);
    if (!row) throw new Error("Key not found");
    const nextTokens = Number(row.token_remaining || 0) + amount;
    if (nextTokens < 0) throw new Error("Token balance cannot be reduced below zero");
    stmts.setTokenRemaining.run(nextTokens, apiKey);
    stmts.insertTxn.run(apiKey, 0, `${reason}:${amount}`, 0, 0, "", "");
    return stmts.getKey.get(apiKey);
  });

  const updated = adjust();
  return { key: apiKey, delta: amount, credit: updated.credit, token_remaining: updated.token_remaining };
}

function extendKeyExpiry(apiKey, days) {
  const duration = Math.trunc(Number(days));
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 3650) {
    throw new Error("Expiry extension must be between 1 and 3650 days");
  }
  const row = stmts.getKey.get(apiKey);
  if (!row) throw new Error("Key not found");

  const currentExpiry = parseExpiryTime(row.expires_at);
  const base = currentExpiry && !Number.isNaN(currentExpiry.getTime()) && currentExpiry > new Date()
    ? currentExpiry
    : new Date();
  base.setDate(base.getDate() + duration);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(base);
  const value = (type) => parts.find((part) => part.type === type).value;
  const expiresAt = `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
  stmts.setExpiry.run(expiresAt, apiKey);
  return { key: apiKey, days: duration, expires_at: expiresAt };
}

/**
 * Tạo key mới
 */
function createKey({ label = "", credit = 0, rpmLimit = 30, expiresAt = null, tokenRemaining = 0, durationDays = 0 } = {}) {
  const key = generateKey();
  return createManualKey({ key, label, credit, rpmLimit, expiresAt, tokenRemaining, durationDays });
}

function createManualKey({ key, label = "", credit = 0, rpmLimit = 30, expiresAt = null, tokenRemaining = 0, durationDays = 0 } = {}) {
  const apiKey = String(key || "").trim();
  if (!apiKey) throw new Error("Manual key is required");
  if (/\s/.test(apiKey)) throw new Error("Manual key must not contain spaces");
  if (apiKey.length < 8 || apiKey.length > 160) throw new Error("Manual key length must be between 8 and 160 characters");
  if (stmts.getKey.get(apiKey)) throw new Error("Key already exists");
  const dur = Math.max(0, Number(durationDays || 0));
  stmts.insertKey.run(apiKey, label, credit, rpmLimit, expiresAt, Number(tokenRemaining || 0), dur);
  if (credit > 0) {
    stmts.insertTxn.run(apiKey, credit, "initial", 0, 0, "", "");
  }
  return stmts.getKey.get(apiKey);
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
  reserveRequest,
  settleRequest,
  refundRequest,
  topupCredit,
  adjustCredit,
  adjustToken,
  extendKeyExpiry,
  createKey,
  createManualKey,
  deleteKey,
  setKeyActive,
  getKey,
  listKeys,
  getHistory,
  getUsageTotal,
  getAllHistory,
  getDailyQuota,
  getQuotaInfo,
  getStats,
  parseExpiryTime,
};
