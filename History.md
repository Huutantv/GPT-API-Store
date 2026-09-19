# History — GPT-API-Store (doro-proxy)

## 2026-09-20 — Nới IP Guard + RPM theo gói (chống ban nhầm, hết ép 30 RPM)
- IP Guard (`ip-guard.js`, `.env.example`): `MAX_KEYS_PER_IP 1→3`, `MAX_IPS_PER_KEY 1→3`, `AUTO_BAN_MINUTES 60→20`. Khách đổi wifi/4G/VPN, xài 2-3 máy, văn quán chung IP không còn bị ban oan; share tràn lan (4+ IP/key) vẫn ban. Lưu ý: VPS `.env` cũ giữ giá trị cũ — phải sửa tay 3 dòng rồi restart.
- RPM (`package_quotas.js` mới `PACKAGE_RPM_TIERS` + `getPackageRpm`): starter 30, pro 60, pro_v2 90, ultra 120. `orders.js` seed + migration chỉ NÂNG lên tier (packages/orders/api_keys qua paid orders), không hạ custom của admin; sửa luôn text "30 RPM" cũ. Xóa ép cứng `rpm_limit=30` mỗi boot ở `orders.js` + `credit.js:92` (trước đây xóa cả custom admin).
- Verify: `node --check` OK; 17 test pass (tiers, seed, đơn mới kế thừa, key cũ paid nâng cấp, custom 200 giữ nguyên, key lẻ không order giữ nguyên, default ipguard).

## 2026-09-20 — Mở API Style cho Backend 1-4 (thay backend tự do)
- Thiếu: server đọc `DORO_BACKEND{id}_API_STYLE` cho cả 5 backend nhưng whitelist `PUT /api/config` và UI chỉ có cho B5/vision/backup → đổi nhà cung cấp Anthropic-native vào slot 1-4 không làm được.
- `doro_proxy_node.js`: whitelist thêm `DORO_BACKEND[1234]_API_STYLE`, regex normalize mở thành `[1-5]|5_VISION`.
- `admin.html`: dropdown API Style cho card 1-4 (mặc định openai); `saveBackend1/2Config` gửi style; `saveBackendConfig` 3/4 và `loadBackendConfig` đã generic, không cần sửa.
- Verify: `node --check` OK; 16 check whitelist/UI/syntax pass.

## 2026-09-20 — Cứu message lỗi 400 + log terminal backend
- Bug: body 400 nhắc tên backend model thật (vd "Model 'composer-2.5' not found") bị `containsBackendLeak` nuốt thành message chung → khách/admin không biết lỗi gì.
- `doro_proxy_node.js`: `publicBackendError` thay tên backend model bằng tên public TRƯỚC rồi check leak lại — sạch thì trả message thật đã thay tên (`Model 'claude-opus-5' not found`, giữ code `model_not_found`); còn host/URL/HTML thì vẫn generic. 401/403 giữ nguyên.
- Thêm 1 dòng `addLog backend terminal ...` ở cả 2 handler (openai/anthropic) để tab Logs thấy lý do thật (đã sanitize).
- Verify: `node --check` OK; 7 test pass (rescue/code/hostname/HTML/401/clean/case-variant).

## 2026-09-20 — Fix Monitor gắn cờ error cho request 200 (error residue sau retry)
- Bug: attempt đầu retry (network/timeout) set `obs.error_type`, attempt sau thành công 200 nhưng residue còn lại → Monitor hiện `Error: network`, `metricsSummary` tính vào error_rate, dù khách nhận 200 bình thường.
- `doro_proxy_node.js`: thêm `clearBackendErrorObservation(obs)` gọi ở 4 điểm success (`postWithKeyFailover`, `postStreamWithKeyFailover`, `streamAnthropic/OpenAIWithFailover`). Giữ `retry_count` trung thực; lỗi stream xảy ra SAU success vẫn set lại ở catch nên không mất cảnh báo thật.
- Verify: `node --check` OK; 5 test logic pass.

## 2026-09-20 — Fix Auto Mode tự tắt mỗi lần Lưu (admin.html)
- Bug: `saveActiveBackend` có dòng `if (autoSwitch) nextAutoMode = "0"` — khi server đang ở state cũ cả 2 cùng bật (=1), UI hiện cả 2 ON, bấm Lưu (không đụng gì) vẫn âm thầm gửi `DORO_AUTO_MODE=0` → Auto Mode tự tắt. Tái hiện + fix bằng cách xóa đúng 1 dòng đó: chỉ gửi đúng trạng thái checkbox khi dirty/khác server; loại trừ nhau giữ ở click-time + server 400.
- Verify: mô phỏng 6 case (stale both untouched, on/off thủ công, tắt từng cái) pass; `node --check` 5 script inline admin.html OK.

## 2026-09-20 — Chống flapping auto-mode bằng hysteresis (thay cách ém tin)
- Rút kinh nghiệm: cách ém tin flapping tuy hết spam nhưng giấu tin đúng → bỏ hoàn toàn, không chặn bất kỳ tin Telegram nào.
- `doro_proxy_node.js`: hồi phục giờ đòi chuỗi thành công LIÊN TIẾP (lỗi xen giữa reset đếm) và giãn cách tối thiểu `DORO_AUTO_WARMUP_MIN_SPREAD_MS` (mặc định 60s), không giới hạn window trên (tránh deadlock khi window < spread). Xóa `backendWarmupPass` (hết dùng); `DORO_AUTO_SOFT_RECOVERY_WINDOW_MS` không còn dùng.
- `.env.example` + whitelist `PUT /api/config`: `DORO_AUTO_WARMUP_MIN_SPREAD_MS` (live, không cần restart); xóa 3 biến `DORO_TELEGRAM_FLAP_*`.
- Verify: `node --check` OK; test mô phỏng case spam thật (3 lỗi → DOWN, 2 OK cách 2s, lỗi tiếp) không còn hồi phục sớm.

## 2026-09-20 (superseded — đã revert, không ém tin nữa) — Chống spam Telegram khi backend flapping (auto-mode)
- Vấn đề: backend chập chờn (3 lỗi 502 → ngắt → 2 request OK là hồi → lại lỗi) khiến mỗi lần chuyển trạng thái gửi 1 tin Telegram (🔴/✅ liên tục).
- `doro_proxy_node.js`: thêm `allowAutoModeTelegram(id, kind)` bọc cả 3 điểm gửi tin auto-mode (DOWN 🔴, recovered ✅, thử lại ℹ️). Quá `DORO_TELEGRAM_FLAP_THRESHOLD` (mặc định 3) lần DOWN trong `DORO_TELEGRAM_FLAP_WINDOW_MS` (10p) → gửi đúng 1 tin "flapping" rồi ngưng tin auto-mode trong `DORO_TELEGRAM_FLAP_COOLDOWN_MS` (15p). Failover/recovery/log vẫn chạy bình thường. Config đọc live từ env + thêm vào whitelist `PUT /api/config`.
- `.env.example`: thêm 3 biến `DORO_TELEGRAM_FLAP_*`. `admin.html`: ghi chú anti-spam trong panel Auto Mode.
- Verify: `node --check` OK; 14 test logic flap pass (đếm đúng, suppress đúng, hết cooldown mở lại, isolated down không trigger).

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
