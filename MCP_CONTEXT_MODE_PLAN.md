# Planning: Them Context Mode MCP vao du an Doro Proxy

## Muc tieu

Tang kha nang lam viec dai hoi cua AI agent khi thao tac tren codebase nay bang Context Mode MCP, giam viec raw output/log/file lon bi day thang vao context.

Luu y: Context Mode khong lam model suy luan gioi hon truc tiep. No giup agent tiet kiem context, goi tool gon hon, va giu continuity tot hon trong cac task dai.

## Trang thai hien tai

Da thuc hien tren may dev:

- Cai global `context-mode@1.0.162`.
- Them `[mcp_servers.context-mode]` vao `C:\Users\PRECISION\.codex\config.toml`.
- Bat `[features] hooks = true` trong config Codex.
- Tao `C:\Users\PRECISION\.codex\hooks.json` theo mau `context-mode/configs/codex/hooks.json`.
- Chay `context-mode doctor`: server, MCP registration, hook config, FTS5/SQLite deu PASS.

Can restart Codex session/client de MCP server va hooks duoc nap day du.

Da thuc hien trong API proxy:

- Them server-side tool allowlist read-only cho non-stream `/v1/chat/completions` va `/v1/responses`.
- Khach hang chi can goi API nhu OpenAI binh thuong; proxy tu cap tool cho model va tu chay tool noi bo.
- Tool hien co: `doro_lookup_order`, `doro_check_credit_balance`, `doro_get_available_packages`, `doro_get_model_quota_status`.
- Khong expose shell, filesystem, raw database query, hay arbitrary MCP tools cho public user.

## Ket luan huong di

Nen trien khai theo 2 giai doan:

1. Cai Context Mode cho AI coding client dang dung tren repo nay.
2. Sau khi on dinh, neu muon user goi API proxy ma AI tu dung tools, moi them MCP client vao `doro_proxy_node.js`.

Context Mode phu hop nhat cho giai doan 1. Voi giai doan 2, cac MCP huu ich hon se la database/order/credit/quota/search tools.

## Giai doan 1: Cai Context Mode cho moi truong dev

### Viec can lam

1. Cai package global:

```bash
npm install -g context-mode
```

2. Them MCP server vao AI client dang dung.

Voi Codex, them vao `~/.codex/config.toml`:

```toml
[mcp_servers.context-mode]
command = "context-mode"
```

3. Restart AI client.

4. Kiem tra trong phien AI:

```text
ctx stats
ctx doctor
```

### Tieu chi hoan thanh

- MCP server `context-mode` hien trang thai active trong client.
- Lenh `ctx stats` tra ve thong tin session.
- Lenh `ctx doctor` khong bao loi nghiem trong ve runtime/hook.

## Giai doan 2: Dung Context Mode khi lam viec voi repo

### Cach dung khuyen nghi

Dung Context Mode cho cac viec co output lon:

- Doc file dai nhu `doro_proxy_node.js`.
- Tim kiem nhieu log trong `logs/`.
- Chay command co output dai.
- Tong hop nhieu file HTML lon nhu `admin.html`, `dashboard.html`, `portal.html`.

Khong can ep dung Context Mode cho viec nho:

- Doc `package.json`.
- Kiem tra mot route cu the.
- Sua mot doan code ngan.

### Rui ro

- Neu client khong co hook enforcement, model co the khong tu routing qua Context Mode deu dan.
- Context Mode co kha nang chay command trong sandbox, nen van can giu permission rule chat che.
- Khong nen cho phep doc `.env`, database production, private key neu chua co rule bao ve.

## Giai doan 3: Neu muon AI trong API proxy tu dung MCP tools

Giai doan nay khac voi Context Mode. Luc nay `doro_proxy_node.js` se dong vai tro MCP client.

### Kien truc de xuat

Them module moi:

```text
mcp-client.js
```

Module nay phu trach:

- Doc config MCP tu `.env`.
- Khoi dong/ket noi MCP servers qua stdio hoac HTTP.
- Lay danh sach MCP tools.
- Convert MCP tool schema sang OpenAI function tools.
- Goi MCP tool khi backend tra `tool_calls`.
- Tra tool result ve model trong mot vong request tiep theo.

### Bien moi truong de xuat

```env
DORO_MCP_ENABLED=false
DORO_MCP_SERVERS=context-mode
DORO_MCP_CONTEXT_MODE_COMMAND=context-mode
DORO_MCP_MAX_TOOL_ROUNDS=3
DORO_MCP_TOOL_TIMEOUT_MS=30000
```

### Diem can sua trong code

- Gan MCP vao `openAIChatCompletionsHandler` trong `doro_proxy_node.js`.
- Gan MCP vao route `/v1/responses` sau khi convert Responses API sang Chat Completions.
- Chi bat MCP khi `DORO_MCP_ENABLED=true`.
- Khong bat mac dinh cho production.

### Flow xu ly

1. Request vao `/v1/chat/completions`.
2. Proxy auth nhu hien tai.
3. Neu MCP enabled, lay tool list tu MCP.
4. Tron tools cua request voi MCP tools.
5. Goi backend model.
6. Neu model tra `tool_calls`, proxy goi MCP tool.
7. Them ket qua tool vao messages.
8. Goi lai backend toi da `DORO_MCP_MAX_TOOL_ROUNDS`.
9. Tra cau tra loi cuoi cho client.

### Tieu chi hoan thanh

- Request khong tool van chay nhu cu.
- Request co MCP tool call tra ket qua dung.
- Stream mode khong bi vo, hoac tam thoi disable MCP auto-loop cho stream trong ban dau.
- Log co ghi tool name, latency, status, nhung khong log secret.
- Credit/token accounting van hoat dong.

## De xuat uu tien

Nen lam ngay:

1. Cai Context Mode vao AI client.
2. Them rule bao ve `.env` va file nhay cam.
3. Dung Context Mode khi agent lam task dai tren repo.

Chua nen lam ngay:

1. Gan Context Mode truc tiep vao API proxy production.
2. Cho public user goi arbitrary MCP tools.
3. Cho MCP doc/ghi filesystem neu chua co allowlist.

## Buoc tiep theo de implement

Neu chi muon cai cho dev:

1. Chay `npm install -g context-mode`.
2. Sua config MCP cua client.
3. Restart client va chay `ctx doctor`.

Neu muon proxy co MCP client:

1. Them dependency MCP SDK phu hop.
2. Tao `mcp-client.js`.
3. Them config `.env.example`.
4. Them MCP tool loop cho non-stream `/v1/chat/completions`.
5. Test bang mot MCP tool an toan truoc, vi du tool `ctx stats` hoac mot custom tool chi read-only.
