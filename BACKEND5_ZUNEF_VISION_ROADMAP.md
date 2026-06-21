# Roadmap Backend 5 Zunef + Vision phụ

Tài liệu này mô tả cách áp dụng mô hình Backend 5 cho một dự án khác:

- Backend 5 chính (Zunef): xử lý text và context dài.
- Backend 5 Vision (`5v`): xử lý request có ảnh mới.
- Hai backend cùng xuất hiện với khách hàng như một backend logic duy nhất.
- Không đưa API key, URL cài đặt thật hoặc device ID của dự án cũ sang dự án khách.

## 1. Kiến trúc mục tiêu

```text
Client
  |
  | /v1/messages hoặc /v1/chat/completions
  v
Proxy + Auth + Router + Monitor
  |
  |-- Tin nhắn user mới nhất có ảnh --> Backend 5 Vision (5v)
  |
  `-- Tin nhắn user mới nhất chỉ có chữ
        |-- Bỏ các block ảnh cũ khỏi lịch sử gửi lên
        `-- Backend 5 Zunef (5)
```

Quy tắc quan trọng: chỉ kiểm tra **tin nhắn `user` mới nhất**. Không được nhìn toàn bộ lịch sử để quyết định route, vì ảnh cũ sẽ khiến mọi câu hỏi chữ tiếp theo đi nhầm sang Vision.

## 2. Bảng quyết định route

| Trường hợp | Backend | Payload gửi lên |
|---|---|---|
| Cuộc trò chuyện mới, chỉ có chữ | Zunef `5` | Giữ nguyên |
| Tin nhắn mới nhất có ảnh | Vision `5v` | Giữ ảnh |
| Lịch sử có ảnh nhưng tin nhắn mới nhất chỉ có chữ | Zunef `5` | Loại ảnh lịch sử |
| Vision chưa cấu hình nhưng request có ảnh | Không dùng Zunef | Trả lỗi cấu hình rõ ràng |
| Zunef lỗi xác thực | Không âm thầm dùng Vision | Trả lỗi hoặc failover sang backend text đã khai báo |

## 3. Roadmap triển khai

### Giai đoạn 1 — Chuẩn hóa cấu hình

1. Tạo riêng một installation/auth URL Zunef cho dự án khách.
2. Chọn một runtime production: PM2 hoặc Docker.
3. Cấu hình Backend 5 chính ở API style `anthropic`.
4. Cấu hình Vision bằng API style thật của nhà cung cấp (`openai` hoặc `anthropic`).
5. Lưu device ID vào vùng dữ liệu bền vững.

### Giai đoạn 2 — Xây router

1. Nhận cả Anthropic Messages API và OpenAI Chat Completions API.
2. Tìm tin nhắn `user` cuối cùng.
3. Phát hiện các block `image`, `image_url`, `input_image` hoặc `source` base64/URL.
4. Chọn profile `5v` nếu có ảnh mới; ngược lại chọn profile `5`.
5. Khi về profile `5`, xóa ảnh nằm trong lịch sử trước khi forward.

### Giai đoạn 3 — Adapter và streaming

1. Zunef dùng native Anthropic: forward đến `/v1/messages`.
2. Vision OpenAI-compatible: forward đến `/chat/completions`.
3. Chuyển đổi payload/response khi API public và API upstream khác style.
4. Hỗ trợ cả stream và non-stream.
5. Với stream, chuyển từng chunk ngay khi nhận; đặt `X-Accel-Buffering: no`.

### Giai đoạn 4 — Quan sát và vận hành

1. Log request type, backend thực tế, model, status, latency và lỗi.
2. Dashboard phải có cột `Type` và `Backend Used`.
3. Không ghi raw API key, auth URL, ảnh base64 hoặc toàn bộ prompt vào log.
4. Đặt timeout riêng từng backend và failover có thứ tự.

### Giai đoạn 5 — Kiểm thử và bàn giao

1. Test ma trận text/ảnh/lịch sử ảnh.
2. Test Anthropic/OpenAI và stream/non-stream.
3. Test helper trong đúng runtime production.
4. Test restart không làm đổi device ID.
5. Bàn giao file `.env.example`, hướng dẫn deploy và rollback.

## 4. Cấu hình mẫu

Không commit `.env` thật. Chỉ commit `.env.example` với placeholder.

```env
# Backend 5 chính: text/context
DORO_BACKEND5_NAME=Zunef
DORO_BACKEND5_BASE_URL=https://claude-api.example.com/v1/ai
DORO_BACKEND5_MODEL=claude-sonnet-example
DORO_BACKEND5_API_STYLE=anthropic
DORO_BACKEND5_API_KEY_HELPER=node zunef_api_key_helper.js
ZUNEF_AUTH_URL=https://provider.example.com/api/claude-code/INSTALLATION_ID/auth
DORO_BACKEND5_API_KEY_CACHE_SECONDS=900
DORO_BACKEND5_API_KEY_HELPER_TIMEOUT_MS=30000
DORO_BACKEND5_AUTH_HEADER=both
DORO_BACKEND5_CUSTOM_HEADERS=X-ZUNEF-CLIENT: claude-code
DORO_BACKEND5_TIMEOUT_MS=60000
DORO_BACKEND5_MAX_TOKENS=32768

# Vision phụ của Backend 5
DORO_BACKEND5_VISION_NAME=Backend 5 Vision
DORO_BACKEND5_VISION_AUTH_TOKEN=replace-with-vision-key
DORO_BACKEND5_VISION_BASE_URL=https://vision-api.example.com/v1
DORO_BACKEND5_VISION_MODEL=replace-with-vision-model
DORO_BACKEND5_VISION_API_STYLE=openai
DORO_BACKEND5_VISION_AUTH_HEADER=bearer
DORO_BACKEND5_VISION_TIMEOUT_MS=60000
DORO_BACKEND5_VISION_MAX_TOKENS=16384

# Backend hoạt động và failover tùy chọn
DORO_ACTIVE_BACKEND=5
DORO_BACKEND_ROUTER_MODE=failover

# Bảo vệ proxy
DORO_REQUIRE_API_KEY=1
DORO_PROXY_KEYS=sk-replace-with-customer-key
DORO_PROXY_PORT=4000
```

Nếu cần backend text dự phòng:

```env
DORO_ACTIVE_BACKEND=5,2
DORO_BACKEND_ROUTER_MODE=failover
DORO_BACKEND2_TIMEOUT_MS=15000
```

Thứ tự có ý nghĩa trong chế độ `failover`: `5,2` nghĩa là thử Zunef trước rồi mới đến Backend 2.

## 5. API-key helper Zunef

Helper có hợp đồng đơn giản:

- Đọc `ZUNEF_AUTH_URL` từ environment.
- Đọc hoặc tạo device ID bền vững.
- Gọi auth endpoint cùng `deviceId` và các header yêu cầu.
- Chỉ in API token ra `stdout`.
- In lỗi ra `stderr` và thoát với exit code khác `0`.
- Tuyệt đối không log token.

Có thể dùng lại `zunef_api_key_helper.js` của dự án này, nhưng phải dùng auth URL và device ID riêng của khách.

Kiểm tra helper mà không làm lộ token:

```bash
ZUNEF_AUTH_URL="$(sed -n 's/^ZUNEF_AUTH_URL=//p' .env | tail -n1)" \
node zunef_api_key_helper.js >/dev/null \
&& echo "Zunef helper OK" || echo "Zunef helper FAILED"
```

## 6. Thuật toán phát hiện ảnh

```js
function isImageContentBlock(block) {
  return Boolean(block && typeof block === "object" && (
    block.type === "image"
    || block.type === "image_url"
    || block.type === "input_image"
    || block.image_url
    || (block.source && ["base64", "url"].includes(block.source.type))
  ));
}

function latestUserImageCount(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return Array.isArray(message.content)
      ? message.content.filter(isImageContentBlock).length
      : 0;
  }
  return 0;
}
```

Không dùng cách sau:

```js
// Sai: một ảnh cũ cũng khiến request text mới đi Vision.
const hasImage = body.messages.some(message =>
  Array.isArray(message.content) && message.content.some(isImageContentBlock)
);
```

## 7. Loại ảnh lịch sử trước khi gửi Zunef

Chỉ thực hiện khi tin nhắn user mới nhất không có ảnh và backend đích là profile `5`.

```js
function bodyForTextBackend(body) {
  const messages = (body.messages || []).map((message) => {
    if (!Array.isArray(message?.content)) return message;

    const content = message.content.filter((block) => !isImageContentBlock(block));
    if (!content.length) {
      content.push({
        type: "text",
        text: "[Historical image omitted for text/context backend]",
      });
    }
    return { ...message, content };
  });

  return { ...body, messages };
}
```

Không mutate `req.body` dùng chung. Luôn tạo object/array mới để retry sang backend khác không nhận payload đã bị thay đổi ngoài ý muốn.

## 8. Chọn profile

```js
async function selectBackend5Profile(requestBody) {
  const needsVision = latestUserImageCount(requestBody) > 0;

  if (needsVision) {
    const vision = backend5VisionProfile();
    if (!vision.configured) {
      throw new Error(
        "Image request requires Backend 5 Vision: configure Base URL, model, and API key"
      );
    }
    return vision;
  }

  return backend5TextProfile();
}
```

Các field chung của một profile nên gồm:

```js
{
  id,
  label,
  baseUrl,
  backendModel,
  apiStyle,
  apiKeys,
  apiKeyHelper,
  authHeaderMode,
  customHeaders,
  timeoutMs,
  maxTokens
}
```

## 9. Endpoint upstream

```js
function upstreamPath(profile) {
  return profile.apiStyle === "anthropic"
    ? "/v1/messages"
    : "/chat/completions";
}
```

Backend 5 Zunef phải ghi trong log:

```text
anthropic->anthropic
```

Nếu log hiển thị `anthropic->openai` trong khi Zunef là native Anthropic, kiểm tra `DORO_BACKEND5_API_STYLE` và environment cũ do PM2 lưu lại.

## 10. Monitor và dashboard

Mỗi access log nên có tối thiểu:

```json
{
  "request_type": "text",
  "image_count": 0,
  "historical_image_count": 1,
  "route_target": "Zunef",
  "route_reason": "latest user message is text/context",
  "backend_id": "5",
  "backend_profile": "Zunef",
  "backend_model": "claude-sonnet-example",
  "status": 200,
  "latency_ms": 4200,
  "error_type": "",
  "error_message": ""
}
```

Dashboard nên hiển thị:

- Type: `Text`, `Image (N)` hoặc `Metadata`.
- Backend Used: `Zunef [5]` hoặc `Backend 5 Vision [5v]`.
- Status, latency và error.
- Request ID để đối chiếu log.

## 11. Timeout, failover và tốc độ

- Không đặt timeout backend chết ở mức 180–300 giây nếu có failover.
- Backend dự phòng nên có timeout time-to-first-byte khoảng 15–30 giây.
- Timeout Zunef có thể đặt 60 giây và điều chỉnh theo p95 thực tế.
- Cache helper khoảng 900 giây; nếu token là JWT, cache phải dừng trước thời điểm `exp`.
- Streaming phải chuyển chunk ngay, không buffer toàn bộ response.
- Với hội thoại dài, compact context sớm hơn sẽ cải thiện tốc độ đáng kể.

Khuyến nghị nâng cấp sau MVP: circuit breaker. Khi một backend timeout, tạm bỏ qua backend đó 30–60 giây thay vì bắt mọi khách hàng tiếp tục chờ cùng một timeout.

## 12. Docker và device ID

Device ID phải tồn tại sau khi recreate container:

```yaml
services:
  proxy:
    volumes:
      - ./.env:/app/.env
      - ./docker-data/claude:/root/.claude
```

Kiểm tra helper trong container:

```bash
docker exec proxy sh -lc \
'node zunef_api_key_helper.js >/dev/null && echo "Docker Zunef OK" || echo "Docker Zunef FAILED"'
```

PM2 dùng device ID của user chạy process, ví dụ `/root/.claude/zunef-device-id`. Docker dùng volume đã mount. Không chạy đồng thời PM2 và Docker nếu không có lý do rõ ràng, vì chúng có thể dùng hai device ID và hai cache token khác nhau.

## 13. Deploy bằng PM2

```bash
cd ~/customer-proxy
npm ci --omit=dev

node --check doro_proxy_node.js

pm2 delete customer-proxy 2>/dev/null || true
pm2 start doro_proxy_node.js --name customer-proxy
pm2 save
```

Xóa rồi tạo lại process lần đầu giúp tránh PM2 giữ `DORO_BACKEND5_API_STYLE=openai` từ cấu hình cũ.

## 14. Deploy bằng Docker

```bash
cd ~/customer-proxy
docker compose up -d --build --force-recreate
docker compose ps
docker logs customer-proxy --tail 50
```

Chỉ expose proxy qua HTTPS reverse proxy. Không expose dashboard quản trị công khai nếu chưa có xác thực.

## 15. Ma trận kiểm thử bắt buộc

| Test | Kết quả mong đợi |
|---|---|
| User gửi `Hi` | Backend `5`, status 200 |
| User gửi ảnh | Backend `5v`, ảnh được forward |
| User gửi ảnh, sau đó hỏi bằng chữ | Backend `5`, ảnh cũ không được forward |
| Ảnh cũ nằm nhiều lượt trước | Vẫn về Backend `5` |
| Request OpenAI text | Adapter đúng, Backend `5` |
| Request Anthropic text | Native Anthropic, Backend `5` |
| Stream text | Nhận chunk đầu tiên, không chờ toàn bộ response |
| Non-stream text | JSON hợp lệ |
| Vision thiếu key/model/URL | Lỗi cấu hình rõ ràng, không gửi ảnh sang Zunef |
| Helper trả lỗi | Không log token; trả lỗi xác thực rõ ràng |
| Backend dự phòng timeout | Failover trong giới hạn đã cấu hình |
| Recreate Docker | Device ID không đổi |

## 16. Checklist bảo mật bàn giao khách hàng

- [ ] Auth URL Zunef riêng cho khách.
- [ ] Vision key riêng cho khách.
- [ ] Proxy key có độ dài đủ mạnh.
- [ ] `.env` không nằm trong Git.
- [ ] Quyền file `.env` là `600` trên Linux.
- [ ] Không hiển thị full backend key trên dashboard.
- [ ] Không ghi prompt, ảnh base64 hoặc token vào access log.
- [ ] Dashboard có admin auth.
- [ ] HTTPS và giới hạn IP/rate limit nếu cần.
- [ ] Có quy trình rotate key và rollback.

## 17. Các file cần mang sang dự án khách

Từ dự án hiện tại, có thể dùng làm tham chiếu:

- `doro_proxy_node.js`: router, adapter, stream, logging và failover.
- `zunef_api_key_helper.js`: lấy key động theo device ID.
- `dashboard.html`: cột Type và Backend Used.
- `.env.example`: schema cấu hình, không lấy giá trị thật.
- `Dockerfile` và `docker-compose.yml`: runtime cùng volume device ID.

Nên tách các phần trên thành module trong dự án mới:

```text
src/
  config/backends.js
  auth/zunef-helper.js
  routing/backend5-router.js
  adapters/anthropic.js
  adapters/openai.js
  streaming/sse.js
  observability/access-log.js
  server.js
```

Cách tách này giúp test router độc lập, thay nhà cung cấp Vision dễ hơn và tránh để toàn bộ logic nằm trong một file lớn.
