# History — GPT-API-Store (doro-proxy)

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
