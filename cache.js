/**
 * cache.js — LRU response cache cho Doro Proxy
 *
 * Lưu raw response bytes (cả stream SSE lẫn non-stream JSON) theo hash key.
 * Mục tiêu: giảm token backend tiêu thụ bằng cách trả lại response cũ cho
 * request giống hệt nhau (cùng model + messages + params).
 *
 * - TTL + max entries + max body bytes để giới hạn RAM.
 * - LRU eviction theo thứ tự insertion (Map giữ thứ tự).
 * - KHÔNG lưu error response (status >= 400) hoặc response sau retry/failover.
 *
 * Cache hit => 0 token backend => KHÔNG trừ credit user.
 */

class ResponseCache {
  constructor(maxEntries = 1000, ttlMs = 600000, maxBodyBytes = 2 * 1024 * 1024) {
    this.maxEntries = Math.max(1, Math.floor(Number(maxEntries) || 1000));
    this.ttlMs = Math.max(1000, Number(ttlMs) || 600000);
    this.maxBodyBytes = Math.max(1024, Number(maxBodyBytes) || (2 * 1024 * 1024));
    this.store = new Map(); // key -> { value, expireAt, size }
    this.totalBytes = 0;
    this.stats = { hits: 0, misses: 0, stored: 0, evicted: 0, expired: 0, rejected: 0 };
  }

  /** Lấy value còn hạn. Trả null khi miss/expired (tự xoá expired). */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return null;
    }
    if (Date.now() > entry.expireAt) {
      this.store.delete(key);
      this.totalBytes -= entry.size;
      this.stats.expired += 1;
      this.stats.misses += 1;
      return null;
    }
    // LRU: xoá rồi set lại để đẩy về cuối Map.
    this.store.delete(key);
    this.store.set(key, entry);
    this.stats.hits += 1;
    return entry.value;
  }

  /** Lưu value. sizeOverride tránh tính lại size cho Buffer. */
  set(key, value, sizeOverride) {
    try {
      const size = Number.isFinite(sizeOverride)
        ? sizeOverride
        : (Buffer.isBuffer(value && value.body) ? value.body.length : Buffer.byteLength(JSON.stringify(value && value.body)));
      if (!Number.isFinite(size) || size <= 0) {
        this.stats.rejected += 1;
        return false;
      }
      if (size > this.maxBodyBytes) {
        this.stats.rejected += 1;
        return false;
      }
      const existing = this.store.get(key);
      if (existing) this.totalBytes -= existing.size;
      this.store.set(key, { value, expireAt: Date.now() + this.ttlMs, size });
      this.totalBytes += size;
      this.stats.stored += 1;
      this._purge();
      return true;
    } catch (_) {
      this.stats.rejected += 1;
      return false;
    }
  }

  _purge() {
    while (this.store.size > this.maxEntries && this.store.size > 0) {
      const oldest = this.store.keys().next().value;
      const entry = this.store.get(oldest);
      if (entry) this.totalBytes -= entry.size;
      this.store.delete(oldest);
      this.stats.evicted += 1;
    }
  }

  clear() {
    const count = this.store.size;
    this.store.clear();
    this.totalBytes = 0;
    return count;
  }

  snapshot() {
    return {
      enabled: true,
      entries: this.store.size,
      total_bytes: this.totalBytes,
      total_kb: Math.round(this.totalBytes / 1024),
      max_entries: this.maxEntries,
      max_body_bytes: this.maxBodyBytes,
      ttl_ms: this.ttlMs,
      ...this.stats,
    };
  }
}

module.exports = { ResponseCache };
