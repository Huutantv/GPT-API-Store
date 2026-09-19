# History — GPT-API-Store (doro-proxy)

## 2026-09-19 (backend-tab) — Key health + Test backend + guard Auto Mode/Switch
- Phát hiện: `key-health.js` trước đây là module chết (viết xong nhưng proxy chưa từng require) — failover key thực tế chỉ round-robin least-inflight, không skip key 401/429.
- `doro_proxy_node.js`
  - Đấu `key-health` vào luồng forward: `orderedBackendKeys` loại key sick/cooldown (fallback thử hết nếu tất cả đều bệnh, log throttle 60s); `trackBackendKeyResult` móc vào 4 điểm (`postWithKeyFailover`, `postStreamWithKeyFailover`, `streamAnthropic/OpenAIWithFailover`); listener sick/cooldown ghi log.
  - Mới `GET /api/key-health` (admin, mask-only, theo index) + `POST /api/key-health/reset` (mở khóa key theo index).
  - Mới `POST /api/backend-test` (admin): ping thật 1 request `max_tokens=1` đúng apiStyle từng backend, trả OK/latency hoặc lỗi chi tiết; không trừ credit khách nhưng có ghi nhận key-health.
  - `PUT /api/config`: từ chối 400 khi `DORO_AUTO_MODE=1` và `DORO_AUTO_SWITCH=1` cùng lúc.
- `admin.html`: badge `OK·N / sick·lỗi / cooldown 429` + nút Reset từng key; nút Test ở cả 8 card (1-5, 5v, backup1-2); thêm nhiều key 1 lần (phẩy/xuống dòng); `Auto Swicht`→`Switch`; weight mặc định 25→20 (khớp server); cảnh báo restart Backend 1 → "áp dụng ngay" (code đọc env live).
- Verify: `node --check` toàn bộ module + 5 script inline admin.html OK; 10 test hành vi key-health pass.
- Lưu ý: key-health state nằm in-memory (mất khi restart) — đúng thiết kế (sick/cooldown là tạm thời).

## 2026-09-19 (audit) — Fix over-block `hasPublicIdentityWithUpstreamSuffix`
- Bug: nhóm `|` trong `upstreamSuffix` không bọc `(?:...)` nên `deepseek|qwen|kimi|moonshot|chatgpt|gpt` khớp trần trong mọi response → cả câu trả lời legit (vd "so sánh GPT với Claude") bị nuốt thành câu identity. Fix: bọc toàn bộ alternation trong non-capturing group.
- Audit 55/55 pass: chặn identity/extraction, legit cho qua, sanitize thay từ đúng chỗ (không nuốt câu), env toggle, wiring egress guard + monitoring.

## 2026-09-19 — Identity guard chặn cứng + monitoring + Docker persistence
- `doro_proxy_node.js`
  - `identitySystemMessage`: thêm block Confidentiality (cấm tiết lộ system/backend/provider mọi hình thức, jailbreak → trả câu identity chuẩn).
  - Mới `isPromptExtractionAttempt` + `identityShortcutKind` (`identity`/`extraction`/null) + env `DORO_IDENTITY_GUARD`, `DORO_IDENTITY_STRICT`; cả 3 endpoint `/v1/chat`, `/v1/messages`, `/v1/responses` trả local, 0 token backend.
  - `isModelIdentityQuestion`: match câu dài/đuôi lịch sự (tới 200 ký tự), bóc quote chống chặn nhầm support; fix `\bdan\b` khớp nhầm "hướng dẫn" → chỉ bắt `DAN mode`/`do anything now`.
  - Mở rộng sanitize: `chatgpt/gpt/qwen/kimi/moonshot/zhipu/minimax`, `trained by...`, `knowledge cutoff`.
  - Monitoring: `req.obs.identity_kind` → access log; `metricsSummary` thêm `identity_shortcut_1m/5m/by_kind`; mới `GET /api/identity/stats` (admin, top IP/key dò, recent probes).
  - `creditDbPath()` (env `DORO_DB_PATH`, mặc định `./credit.db`); 4 chỗ inline dùng helper.
- `credit.js`: đã hỗ trợ `DORO_DB_PATH` từ trước (giữ nguyên). `ip-guard.js`, `orders.js`: thêm hỗ trợ `DORO_DB_PATH`.
- `docker-compose.yml`: healthcheck `python` → `node` (khớp Dockerfile); thêm named volume `proxy-data:/app/data` + `DORO_DB_PATH=/app/data/credit.db`.
- `backup.sh`: backup cả PM2/local (`$DORO_DB_PATH` hoặc `~/gpt-api-store/credit.db`) lẫn Docker volume (db+wal+shm), giữ 7 ngày.
- `.env.example`: thêm `DORO_IDENTITY_GUARD`, `DORO_IDENTITY_STRICT`, `DORO_DB_PATH` (comment).
- `admin.html`: tile "Dò model / moi prompt (1h)" + chi tiết identity/extraction trên overview.
- Verify: `node --check` toàn bộ module OK; 36 test identity + 18 test kind/monitoring/persistence pass.
- Lưu ý deploy Docker: lần rebuild đầu sau change này tạo volume mới (DB cũ trong container vốn ephemeral, không giữ được).
