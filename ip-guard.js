/**
 * ip-guard.js — IP-level rate limiting & blocklist for Doro Proxy
 *
 * Mục tiêu:
 * - Chặn DDoS / spam ở lớp ứng dụng (sau nginx/Cloudflare).
 * - Auto-ban theo RPS / RPM / 4xx / unauth trong sliding window.
 * - Cho phép admin block / unblock thủ công (IP hoặc CIDR).
 * - Whitelist mặc định cho localhost + healthcheck.
 *
 * Persistence: dùng chung file credit.db.
 * Hot path: chỉ touch in-memory Map, không hit SQLite mỗi request.
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "credit.db");
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS ip_blocks (
    ip          TEXT PRIMARY KEY,
    reason      TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'manual',
    hits        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT,
    note        TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ip_whitelist (
    ip          TEXT PRIMARY KEY,
    note        TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ip_blocks_expires ON ip_blocks(expires_at);
`);

const stmts = {
  listBlocks: db.prepare(`
    SELECT ip, reason, source, hits, created_at, expires_at, note
    FROM ip_blocks
    ORDER BY created_at DESC
  `),
  getBlock: db.prepare("SELECT * FROM ip_blocks WHERE ip = ?"),
  upsertBlock: db.prepare(`
    INSERT INTO ip_blocks (ip, reason, source, hits, expires_at, note)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      reason = excluded.reason,
      source = excluded.source,
      expires_at = excluded.expires_at,
      note = excluded.note
  `),
  incrementHits: db.prepare("UPDATE ip_blocks SET hits = hits + 1 WHERE ip = ?"),
  deleteBlock: db.prepare("DELETE FROM ip_blocks WHERE ip = ?"),
  cleanExpired: db.prepare(
    "DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
  ),
  listWhitelist: db.prepare("SELECT ip, note, created_at FROM ip_whitelist ORDER BY created_at DESC"),
  upsertWhitelist: db.prepare(`
    INSERT INTO ip_whitelist (ip, note) VALUES (?, ?)
    ON CONFLICT(ip) DO UPDATE SET note = excluded.note
  `),
  deleteWhitelist: db.prepare("DELETE FROM ip_whitelist WHERE ip = ?"),
};

// ── In-memory state ────────────────────────────────────────────────────────
const blockedIps = new Map();      // ip -> { reason, source, expiresAt }
const blockedCidrs = [];           // [{ cidr, base, mask, family, reason, expiresAt }]
const whitelistIps = new Set();
const whitelistCidrs = [];

const ipCounters = new Map();      // ip -> { reqs: [ts...], unauth: [ts...], err4xx: [ts...] }
const stats = {
  blocked_requests: 0,
  auto_bans_total: 0,
  manual_bans_total: 0,
  last_auto_ban_ip: "",
  last_auto_ban_reason: "",
  last_auto_ban_at: null,
};

// Path không tính RPS (healthcheck, tài nguyên public).
const BYPASS_PATHS = new Set(["/health", "/favicon.ico"]);

// ── Helpers ────────────────────────────────────────────────────────────────
function envFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s);
}

function envInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isoFromSec(sec) {
  return new Date(sec * 1000).toISOString();
}

function normalizeIp(raw) {
  if (!raw) return "";
  let ip = String(raw).trim();
  // strip port nếu lỡ kèm
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) ip = ip.slice(1, end);
  } else if (ip.split(":").length === 2 && /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(":")[0];
  }
  // ipv4-mapped ipv6 -> ipv4
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

function isIPv4(ip) {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip);
}

function isIPv6(ip) {
  return ip.includes(":") && !isIPv4(ip);
}

function ipv4ToInt(ip) {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv6ToBigInt(ip) {
  // Mở rộng :: và parse thành BigInt 128-bit
  let groups;
  if (ip.includes("::")) {
    const [head, tail] = ip.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    const v = parseInt(g || "0", 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) return null;
    result = (result << 16n) | BigInt(v);
  }
  return result;
}

function parseCidr(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const [ip, prefixStr] = raw.split("/");
  if (!ip || !prefixStr) return null;
  const prefix = Number(prefixStr);
  if (!Number.isFinite(prefix) || prefix < 0) return null;
  if (isIPv4(ip)) {
    if (prefix > 32) return null;
    const base = ipv4ToInt(ip);
    if (base === null) return null;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { family: 4, base: BigInt((base & mask) >>> 0), mask: BigInt(mask), prefix };
  }
  if (isIPv6(ip)) {
    if (prefix > 128) return null;
    const base = ipv6ToBigInt(ip);
    if (base === null) return null;
    const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
    return { family: 6, base: base & mask, mask, prefix };
  }
  return null;
}

function ipMatchesCidr(ip, cidr) {
  if (!cidr) return false;
  if (cidr.family === 4) {
    if (!isIPv4(ip)) return false;
    const v = ipv4ToInt(ip);
    if (v === null) return false;
    return (BigInt(v) & cidr.mask) === cidr.base;
  }
  if (cidr.family === 6) {
    if (!isIPv6(ip)) return false;
    const v = ipv6ToBigInt(ip);
    if (v === null) return false;
    return (v & cidr.mask) === cidr.base;
  }
  return false;
}

// ── Config ─────────────────────────────────────────────────────────────────
function config() {
  return {
    enabled: envFlag(process.env.DORO_IPGUARD_ENABLED, true),
    rpsLimit: envInt(process.env.DORO_IPGUARD_RPS_LIMIT, 25),
    rpmLimit: envInt(process.env.DORO_IPGUARD_RPM_LIMIT, 400),
    unauthLimit: envInt(process.env.DORO_IPGUARD_UNAUTH_LIMIT, 30),
    err4xxLimit: envInt(process.env.DORO_IPGUARD_ERR4XX_LIMIT || process.env.DORO_IPGUARD_404_LIMIT, 60),
    autoBanMinutes: envInt(process.env.DORO_IPGUARD_AUTO_BAN_MINUTES, 60),
    trustCfHeader: envFlag(process.env.DORO_IPGUARD_TRUST_CF, true),
    extraWhitelist: String(process.env.DORO_IPGUARD_WHITELIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

// ── Cache load ─────────────────────────────────────────────────────────────
function reloadCache() {
  blockedIps.clear();
  blockedCidrs.length = 0;
  // Dọn expired trước
  try { stmts.cleanExpired.run(); } catch (_) {}
  const rows = stmts.listBlocks.all();
  const now = nowSec();
  for (const row of rows) {
    let expiresSec = null;
    if (row.expires_at) {
      const t = Date.parse(row.expires_at.replace(" ", "T") + "Z");
      if (Number.isFinite(t)) expiresSec = Math.floor(t / 1000);
      if (expiresSec !== null && expiresSec < now) continue;
    }
    if (row.ip.includes("/")) {
      const cidr = parseCidr(row.ip);
      if (cidr) blockedCidrs.push({ ...cidr, ip: row.ip, reason: row.reason, source: row.source, expiresAt: expiresSec });
    } else {
      blockedIps.set(row.ip, { reason: row.reason, source: row.source, expiresAt: expiresSec });
    }
  }
  whitelistIps.clear();
  whitelistCidrs.length = 0;
  // Whitelist mặc định
  for (const ip of ["127.0.0.1", "::1", "localhost"]) whitelistIps.add(ip);
  // Whitelist từ DB
  for (const row of stmts.listWhitelist.all()) {
    if (row.ip.includes("/")) {
      const cidr = parseCidr(row.ip);
      if (cidr) whitelistCidrs.push({ ...cidr, ip: row.ip, note: row.note });
    } else {
      whitelistIps.add(row.ip);
    }
  }
  // Whitelist từ env
  for (const ip of config().extraWhitelist) {
    if (ip.includes("/")) {
      const cidr = parseCidr(ip);
      if (cidr) whitelistCidrs.push({ ...cidr, ip, note: "env" });
    } else {
      whitelistIps.add(ip);
    }
  }
}

reloadCache();
// Dọn block hết hạn + reload cache mỗi phút
setInterval(() => {
  try {
    stmts.cleanExpired.run();
    reloadCache();
  } catch (_) {}
}, 60 * 1000);

// Dọn counter cũ mỗi 30s
setInterval(() => {
  const cutoff = nowSec() - 60;
  for (const [ip, c] of ipCounters.entries()) {
    c.reqs = c.reqs.filter((t) => t >= cutoff);
    c.unauth = c.unauth.filter((t) => t >= cutoff);
    c.err4xx = c.err4xx.filter((t) => t >= cutoff);
    if (!c.reqs.length && !c.unauth.length && !c.err4xx.length) ipCounters.delete(ip);
  }
}, 30 * 1000);

// ── Public helpers ─────────────────────────────────────────────────────────
function getClientIp(req) {
  const cfg = config();
  if (cfg.trustCfHeader) {
    const cf = req.get && req.get("cf-connecting-ip");
    if (cf) return normalizeIp(cf);
  }
  const forwarded = String((req.get && req.get("x-forwarded-for")) || "").split(",")[0].trim();
  if (forwarded) return normalizeIp(forwarded);
  const real = req.get && req.get("x-real-ip");
  if (real) return normalizeIp(real);
  return normalizeIp(req.ip || (req.socket && req.socket.remoteAddress) || "");
}

function isWhitelisted(ip) {
  if (!ip) return false;
  if (whitelistIps.has(ip)) return true;
  for (const c of whitelistCidrs) if (ipMatchesCidr(ip, c)) return true;
  return false;
}

function findBlock(ip) {
  if (!ip) return null;
  const direct = blockedIps.get(ip);
  if (direct) {
    if (direct.expiresAt !== null && direct.expiresAt < nowSec()) {
      blockedIps.delete(ip);
      return null;
    }
    return { ip, ...direct };
  }
  for (const c of blockedCidrs) {
    if (c.expiresAt !== null && c.expiresAt < nowSec()) continue;
    if (ipMatchesCidr(ip, c)) {
      return { ip: c.ip, reason: c.reason, source: c.source, expiresAt: c.expiresAt };
    }
  }
  return null;
}

function recordHit(ip, kind) {
  let c = ipCounters.get(ip);
  if (!c) {
    c = { reqs: [], unauth: [], err4xx: [] };
    ipCounters.set(ip, c);
  }
  const t = nowSec();
  if (kind === "req") c.reqs.push(t);
  else if (kind === "unauth") c.unauth.push(t);
  else if (kind === "err4xx") c.err4xx.push(t);
  // Cap để tránh memory leak
  if (c.reqs.length > 2000) c.reqs.splice(0, c.reqs.length - 2000);
  if (c.unauth.length > 500) c.unauth.splice(0, c.unauth.length - 500);
  if (c.err4xx.length > 500) c.err4xx.splice(0, c.err4xx.length - 500);
}

function countSince(arr, sinceSec) {
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] >= sinceSec) n++;
    else break;
  }
  return n;
}

function shouldAutoBan(ip) {
  const c = ipCounters.get(ip);
  if (!c) return null;
  const cfg = config();
  const now = nowSec();
  const rps = countSince(c.reqs, now - 1);
  const rpm = countSince(c.reqs, now - 60);
  const unauth60 = countSince(c.unauth, now - 60);
  const err4xx60 = countSince(c.err4xx, now - 60);
  if (cfg.rpsLimit > 0 && rps > cfg.rpsLimit) return { reason: `rps>${cfg.rpsLimit} (got ${rps})`, source: "auto_rps" };
  if (cfg.rpmLimit > 0 && rpm > cfg.rpmLimit) return { reason: `rpm>${cfg.rpmLimit} (got ${rpm})`, source: "auto_rpm" };
  if (cfg.unauthLimit > 0 && unauth60 > cfg.unauthLimit) return { reason: `unauth>${cfg.unauthLimit}/60s`, source: "auto_unauth" };
  if (cfg.err4xxLimit > 0 && err4xx60 > cfg.err4xxLimit) return { reason: `4xx>${cfg.err4xxLimit}/60s`, source: "auto_4xx" };
  return null;
}

function banIp(ip, { reason = "", source = "manual", minutes = null, note = "" } = {}) {
  const ipNorm = ip.includes("/") ? ip : normalizeIp(ip);
  if (!ipNorm) return { ok: false, error: "empty ip" };
  if (isWhitelisted(ipNorm)) return { ok: false, error: "ip is whitelisted" };
  const cfg = config();
  const useMinutes = minutes === null || minutes === undefined ? cfg.autoBanMinutes : Number(minutes);
  let expiresIso = null;
  let expiresSec = null;
  if (useMinutes && useMinutes > 0) {
    expiresSec = nowSec() + Math.floor(useMinutes * 60);
    expiresIso = isoFromSec(expiresSec).slice(0, 19).replace("T", " ");
  }
  stmts.upsertBlock.run(ipNorm, reason || "", source || "manual", expiresIso, note || "");
  if (ipNorm.includes("/")) {
    const cidr = parseCidr(ipNorm);
    if (cidr) {
      // remove existing entry với cùng ip
      for (let i = blockedCidrs.length - 1; i >= 0; i--) if (blockedCidrs[i].ip === ipNorm) blockedCidrs.splice(i, 1);
      blockedCidrs.push({ ...cidr, ip: ipNorm, reason, source, expiresAt: expiresSec });
    }
  } else {
    blockedIps.set(ipNorm, { reason, source, expiresAt: expiresSec });
  }
  if (source === "manual") stats.manual_bans_total++;
  else {
    stats.auto_bans_total++;
    stats.last_auto_ban_ip = ipNorm;
    stats.last_auto_ban_reason = reason || source;
    stats.last_auto_ban_at = new Date().toISOString();
  }
  return { ok: true, ip: ipNorm, expires_at: expiresIso, reason, source };
}

function unbanIp(ip) {
  const ipNorm = ip.includes("/") ? ip : normalizeIp(ip);
  if (!ipNorm) return { ok: false, error: "empty ip" };
  const result = stmts.deleteBlock.run(ipNorm);
  blockedIps.delete(ipNorm);
  for (let i = blockedCidrs.length - 1; i >= 0; i--) if (blockedCidrs[i].ip === ipNorm) blockedCidrs.splice(i, 1);
  return { ok: result.changes > 0, ip: ipNorm };
}

function addWhitelist(ip, note = "") {
  const ipNorm = ip.includes("/") ? ip : normalizeIp(ip);
  if (!ipNorm) return { ok: false, error: "empty ip" };
  stmts.upsertWhitelist.run(ipNorm, note || "");
  if (ipNorm.includes("/")) {
    const cidr = parseCidr(ipNorm);
    if (cidr) {
      for (let i = whitelistCidrs.length - 1; i >= 0; i--) if (whitelistCidrs[i].ip === ipNorm) whitelistCidrs.splice(i, 1);
      whitelistCidrs.push({ ...cidr, ip: ipNorm, note });
    }
  } else {
    whitelistIps.add(ipNorm);
  }
  // Block list nếu IP đó đang trong block, xoá block để tránh xung đột
  if (blockedIps.has(ipNorm)) {
    blockedIps.delete(ipNorm);
    stmts.deleteBlock.run(ipNorm);
  }
  return { ok: true, ip: ipNorm, note };
}

function removeWhitelist(ip) {
  const ipNorm = ip.includes("/") ? ip : normalizeIp(ip);
  if (!ipNorm) return { ok: false, error: "empty ip" };
  const result = stmts.deleteWhitelist.run(ipNorm);
  whitelistIps.delete(ipNorm);
  for (let i = whitelistCidrs.length - 1; i >= 0; i--) if (whitelistCidrs[i].ip === ipNorm) whitelistCidrs.splice(i, 1);
  // Reload để khôi phục defaults nếu user xoá nhầm 127.0.0.1
  reloadCache();
  return { ok: result.changes > 0, ip: ipNorm };
}

function listBlocks() {
  try { stmts.cleanExpired.run(); } catch (_) {}
  const rows = stmts.listBlocks.all();
  return rows.map((row) => ({
    ip: row.ip,
    reason: row.reason,
    source: row.source,
    hits: row.hits,
    created_at: row.created_at,
    expires_at: row.expires_at,
    note: row.note,
    is_active: !row.expires_at || Date.parse(row.expires_at.replace(" ", "T") + "Z") > Date.now(),
  }));
}

function listWhitelist() {
  return stmts.listWhitelist.all();
}

function topIps(limit = 50) {
  const now = nowSec();
  const out = [];
  for (const [ip, c] of ipCounters.entries()) {
    const rps = countSince(c.reqs, now - 1);
    const rpm = countSince(c.reqs, now - 60);
    const r5m = countSince(c.reqs, now - 300);
    const unauth = countSince(c.unauth, now - 60);
    const err4xx = countSince(c.err4xx, now - 60);
    if (rpm === 0 && r5m === 0) continue;
    out.push({
      ip,
      rps,
      rpm,
      requests_5m: r5m,
      unauth_60s: unauth,
      err4xx_60s: err4xx,
      whitelisted: isWhitelisted(ip),
      blocked: !!findBlock(ip),
    });
  }
  out.sort((a, b) => b.rpm - a.rpm || b.requests_5m - a.requests_5m);
  return out.slice(0, limit);
}

function snapshotStats() {
  const cfg = config();
  return {
    enabled: cfg.enabled,
    config: {
      rps_limit: cfg.rpsLimit,
      rpm_limit: cfg.rpmLimit,
      unauth_limit: cfg.unauthLimit,
      err4xx_limit: cfg.err4xxLimit,
      auto_ban_minutes: cfg.autoBanMinutes,
      trust_cf_header: cfg.trustCfHeader,
    },
    blocked_ip_count: blockedIps.size,
    blocked_cidr_count: blockedCidrs.length,
    whitelist_ip_count: whitelistIps.size,
    whitelist_cidr_count: whitelistCidrs.length,
    tracked_ip_count: ipCounters.size,
    blocked_requests: stats.blocked_requests,
    auto_bans_total: stats.auto_bans_total,
    manual_bans_total: stats.manual_bans_total,
    last_auto_ban_ip: stats.last_auto_ban_ip,
    last_auto_ban_reason: stats.last_auto_ban_reason,
    last_auto_ban_at: stats.last_auto_ban_at,
  };
}

// ── Middleware ─────────────────────────────────────────────────────────────
function makeMiddleware({ onAutoBan, onBlocked, whitelistPaths = [] } = {}) {
  const pathSet = new Set(whitelistPaths);
  return function ipGuardMiddleware(req, res, next) {
    const cfg = config();
    if (!cfg.enabled) return next();
    if (BYPASS_PATHS.has(req.path)) return next();
    if (pathSet.has(req.path)) return next();

    const ip = getClientIp(req);
    req.ipGuardClient = ip;

    if (!ip) return next();
    if (isWhitelisted(ip)) return next();

    const block = findBlock(ip);
    if (block) {
      stats.blocked_requests++;
      try { stmts.incrementHits.run(block.ip); } catch (_) {}
      const retryAfter = block.expiresAt ? Math.max(1, block.expiresAt - nowSec()) : 3600;
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-IP-Block-Reason", String(block.reason || "blocked").slice(0, 200));
      if (typeof onBlocked === "function") {
        try { onBlocked({ ip, path: req.path, reason: block.reason }); } catch (_) {}
      }
      return res.status(403).json({
        detail: "Your IP has been blocked due to abusive traffic.",
        code: "ip_blocked",
        ip,
        reason: block.reason || "",
        retry_after_seconds: retryAfter,
      });
    }

    recordHit(ip, "req");

    // Đánh dấu unauth khi gọi vào API endpoint mà không có Authorization
    const isApiPath = req.path.startsWith("/v1/") || req.path === "/messages" ||
                      req.path === "/responses" || req.path === "/chat/completions";
    if (isApiPath) {
      const auth = req.get("authorization") || req.get("x-api-key") || "";
      if (!auth) recordHit(ip, "unauth");
    }

    const ban = shouldAutoBan(ip);
    if (ban) {
      const result = banIp(ip, { reason: ban.reason, source: ban.source, minutes: cfg.autoBanMinutes });
      if (result.ok && typeof onAutoBan === "function") {
        try { onAutoBan({ ip, reason: ban.reason, source: ban.source, minutes: cfg.autoBanMinutes }); } catch (_) {}
      }
      const retryAfter = cfg.autoBanMinutes * 60;
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-IP-Block-Reason", ban.reason);
      return res.status(429).json({
        detail: "Rate limit exceeded. Your IP has been temporarily blocked.",
        code: "ip_auto_banned",
        ip,
        reason: ban.reason,
        retry_after_seconds: retryAfter,
      });
    }

    // Hook vào response để track 4xx
    res.on("finish", () => {
      try {
        if (res.statusCode >= 400 && res.statusCode < 500) recordHit(ip, "err4xx");
      } catch (_) {}
    });

    next();
  };
}

function refreshConfig() {
  // Config ???c ??c ??ng qua h?m config() m?i request, ch? reload cache.
  reloadCache();
}

module.exports = {
  middleware: makeMiddleware,
  banIp,
  unbanIp,
  addWhitelist,
  removeWhitelist,
  listBlocks,
  listWhitelist,
  topIps,
  snapshotStats,
  reloadCache,
  refreshConfig,
  getClientIp,
  isWhitelisted,
  findBlock,
  config,
};