/**
 * key-health.js — Per-backend-key health tracking
 *
 * Mục tiêu:
 * - Skip key bị sick (401/403/quota) trong N phút thay vì retry mỗi request.
 * - Cooldown key bị 429 trong M giây.
 * - Đếm daily request per key để cân bằng tải đều hơn.
 * - Expose snapshot cho admin endpoint.
 */

let _onSickListener = null;
let _onCooldownListener = null;
let _onAutoBlockedListener = null;
function setSickListener(fn) { _onSickListener = typeof fn === "function" ? fn : null; }
function setCooldownListener(fn) { _onCooldownListener = typeof fn === "function" ? fn : null; }
function setAutoBlockedListener(fn) { _onAutoBlockedListener = typeof fn === "function" ? fn : null; }

const STATE = new Map(); // key -> { sickUntil, cooldownUntil, dailyCount, dailyDay, totalReqs, totalErrors, lastError, lastErrorAt }

function nowMs() { return Date.now(); }
function todayKey() { return new Date().toISOString().slice(0, 10); }

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getState(key) {
  let s = STATE.get(key);
  if (!s) {
    s = {
      sickUntil: 0,       // ms epoch — key bị mark sick (401/403/quota/ban)
      cooldownUntil: 0,   // ms epoch — key bị 429, cooldown ngắn
      dailyCount: 0,      // số request hôm nay
      dailyDay: todayKey(),
      totalReqs: 0,
      totalErrors: 0,
      lastError: null,
      lastErrorAt: null,
      lastUsedAt: null,
    };
    STATE.set(key, s);
  }
  // Reset daily counter khi sang ngày mới
  const today = todayKey();
  if (s.dailyDay !== today) {
    s.dailyCount = 0;
    s.dailyDay = today;
  }
  return s;
}

/**
 * Kiểm tra key có sẵn sàng nhận request không.
 * @returns { available: bool, reason: string }
 */
function isKeyAvailable(key) {
  const s = getState(key);
  const now = nowMs();
  if (s.sickUntil > now) {
    return { available: false, reason: `sick until ${new Date(s.sickUntil).toISOString()} (${s.lastError || "error"})` };
  }
  if (s.cooldownUntil > now) {
    return { available: false, reason: `cooldown ${Math.ceil((s.cooldownUntil - now) / 1000)}s (429)` };
  }
  return { available: true, reason: "" };
}

/**
 * Gọi sau mỗi response thành công.
 */
function recordSuccess(key) {
  const s = getState(key);
  s.totalReqs++;
  s.dailyCount++;
  s.lastUsedAt = new Date().toISOString();
  // Xóa sick/cooldown nếu có
  s.sickUntil = 0;
  s.cooldownUntil = 0;
}

/**
 * Gọi sau mỗi response lỗi.
 * @param {string} key
 * @param {number} status HTTP status code
 * @param {string} [bodyText] raw body để detect quota message
 */
function recordError(key, status, bodyText) {
  const s = getState(key);
  s.totalErrors++;
  s.lastError = `HTTP ${status}`;
  s.lastErrorAt = new Date().toISOString();

  const sickMinutes = envInt("DORO_KEY_SICK_MINUTES", 10);
  const cooldownSec = envInt("DORO_KEY_COOLDOWN_SECONDS", 60);

  const text = String(bodyText || "").toLowerCase();
  const isQuotaError = text.includes("quota") || text.includes("exceeded") ||
                       text.includes("limit reached") || text.includes("insufficient");
  const isAuthError = [401, 402, 403].includes(status);
  const isRateLimit = status === 429 && !isQuotaError;

  if (isAuthError || isQuotaError) {
    // Key chết hoặc hết quota — sick N phút
    const sickMs = sickMinutes * 60 * 1000;
    const wasSick = s.sickUntil > nowMs();
    s.sickUntil = nowMs() + sickMs;
    s.lastError = isQuotaError ? `quota_exceeded (${status})` : `auth_error (${status})`;
    if (!wasSick && _onSickListener) {
      try { _onSickListener({ key, status, lastError: s.lastError, sickUntilMs: s.sickUntil, sickMinutes }); } catch (_) {}
    }
  } else if (isRateLimit) {
    // 429 không do quota — cooldown ngắn
    const wasCooling = s.cooldownUntil > nowMs();
    s.cooldownUntil = nowMs() + cooldownSec * 1000;
    s.lastError = `rate_limited (429)`;
    if (!wasCooling && _onCooldownListener) {
      try { _onCooldownListener({ key, status, cooldownUntilMs: s.cooldownUntil, cooldownSec }); } catch (_) {}
    }
  }
  // 5xx, timeout: không mark sick, cho phép retry ngay (backend vấn đề, không phải key)
}

/**
 * Sắp xếp keys: loại bỏ unavailable, ưu tiên least-daily-count + least-inflight.
 * @param {string[]} keys
 * @param {Map<string,number>} inflightMap
 * @returns { available: string[], skipped: string[] }
 */
function rankKeys(keys, inflightMap = new Map()) {
  const now = nowMs();
  const available = [];
  const skipped = [];

  for (const key of keys) {
    const s = getState(key);
    const avail = isKeyAvailable(key);
    if (!avail.available) {
      skipped.push({ key, reason: avail.reason });
      continue;
    }
    available.push({
      key,
      inflight: inflightMap.get(key) || 0,
      dailyCount: s.dailyCount,
    });
  }

  // Sort: ít daily count nhất → ít inflight nhất
  available.sort((a, b) =>
    (a.dailyCount - b.dailyCount) || (a.inflight - b.inflight)
  );

  return {
    available: available.map((x) => x.key),
    skipped,
  };
}

/**
 * Snapshot trạng thái tất cả keys để hiện lên admin UI.
 */
function snapshot(keys) {
  const now = nowMs();
  return keys.map((key) => {
    const s = getState(key);
    const masked = key.slice(0, 8) + "..." + key.slice(-4);
    const avail = isKeyAvailable(key);
    // Note: key_full chỉ trả cho admin endpoint vì /api/key-health đã có checkAdminAuth
    let status = "healthy";
    if (s.sickUntil > now) status = "sick";
    else if (s.cooldownUntil > now) status = "cooldown";
    return {
      key_full: key,
      key_masked: masked,
      status,
      available: avail.available,
      unavailable_reason: avail.reason || null,
      daily_count: s.dailyCount,
      daily_day: s.dailyDay,
      total_reqs: s.totalReqs,
      total_errors: s.totalErrors,
      last_error: s.lastError,
      last_error_at: s.lastErrorAt,
      last_used_at: s.lastUsedAt,
      sick_until: s.sickUntil > now ? new Date(s.sickUntil).toISOString() : null,
      cooldown_until: s.cooldownUntil > now ? new Date(s.cooldownUntil).toISOString() : null,
    };
  });
}

/**
 * Reset sick/cooldown cho 1 key (admin manual reset).
 */
function resetKey(key) {
  const s = STATE.get(key);
  if (!s) return false;
  s.sickUntil = 0;
  s.cooldownUntil = 0;
  s.lastError = null;
  s.lastErrorAt = null;
  return true;
}

/**
 * Reset daily counter tất cả keys (thường không cần, tự reset lúc sang ngày).
 */
function resetDailyAll() {
  for (const s of STATE.values()) {
    s.dailyCount = 0;
    s.dailyDay = todayKey();
  }
}

function getConfig() {
  return {
    sick_minutes: envInt("DORO_KEY_SICK_MINUTES", 10),
    cooldown_seconds: envInt("DORO_KEY_COOLDOWN_SECONDS", 60),
    auto_block_listener_enabled: !!_onAutoBlockedListener,
  };
}

module.exports = {
  setSickListener,
  setCooldownListener,
  setAutoBlockedListener,
  getConfig,
  isKeyAvailable,
  recordSuccess,
  recordError,
  rankKeys,
  snapshot,
  resetKey,
  resetDailyAll,
};
