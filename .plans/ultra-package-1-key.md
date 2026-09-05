# Plan: Gói Ultra - Đổi 5 API Keys thành 1 API Key

## Overview
Gói Ultra hiện tại hiển thị "5 API Keys". Cần đổi thành **1 API Key** để phù hợp nhu cầu (hệ thống thực tế chỉ phát 1 key/đơn hàng, "5 keys" chỉ là text marketing).

## Thực trạng gói Ultra

**Frontend `index.html` (card Ultra, ~dòng 215-231):**
- 5 API Keys
- 60 RPM
- GPT-5.6-Terra, Luna, SOL & 15 models
- Streaming, Vision, Tools
- 450K VNĐ
- Badge "Sắp ra mắt" + button disabled (chưa mở bán)

**Backend `orders.js` (~dòng 62):**
- `{ id: "ultra", price: 450000, credit: 30000, token_quota: 0, rpm_limit: 30, description: "... 5 API key, 30 RPM", active: 0 }`
- `active: 0` → chưa bán
- Dòng 71: `UPDATE packages SET rpm_limit = 30` ép toàn bộ gói về 30 RPM (mâu thuẫn với "60 RPM" trên card)

## File thay đổi
- `index.html` - Đổi text "5 API Keys" → "1 API Key"
- `orders.js` - Đổi description seed của ultra "5 API key" → "1 API key"

## Các bước

### Step 1: `index.html` (card Ultra, dòng 225)
```html
<!-- Cũ -->
<li>&#x2705; 5 API Keys</li>
<!-- Mới -->
<li>&#x2705; 1 API Key</li>
```

### Step 2: `orders.js` (seed ultra, dòng 62)
```js
// Cũ
{ id: "ultra", ..., description: "30.000 credit (~30M token), 5 API key, 30 RPM", active: 0 },
// Mới
{ id: "ultra", ..., description: "30.000 credit (~30M token), 1 API key, 30 RPM", active: 0 },
```

### Step 3: Đồng bộ DB đang chạy trên VPS (quan trọng)
- Seed chỉ chạy `INSERT OR IGNORE`, nên **không** tự cập nhật package `ultra` đã tồn tại trong DB.
- Cần cập nhật trực tiếp DB (hoặc dùng admin API `PUT /api/admin/packages/ultra`) với description mới.
- Tham khảo pattern đồng bộ có sẵn trong `orders.js` (dòng 71-72).

## Quyết định đã xác nhận
1. **RPM**: Ultra giữ **30 RPM** (đổi card từ "60 RPM" → "30 RPM" cho khớp backend).
2. **Trạng thái bán**: **Mở bán luôn** — `active: 1`, bỏ badge "Sắp ra mắt", bật nút "Mua ngay" (`/checkout?pkg=ultra`).
3. **Key count**: 5 → 1.

## Implementation Steps
1. Sửa `index.html` card Ultra: "5 API Keys" → "1 API Key", "60 RPM" → "30 RPM", bỏ `opacity-45` + badge "Sắp ra mắt" → badge "ĐANG MỞ BÁN", đổi button disabled → link "Mua ngay" `/checkout?pkg=ultra`, thêm dòng thời hạn 30 ngày.
2. Sửa `orders.js` seed ultra: `active: 0` → `1`, description "5 API key" → "1 API key".
3. Cập nhật DB VPS trực tiếp (seed dùng `INSERT OR IGNORE` nên không tự cập nhật):
   `UPDATE packages SET description=?, active=1 WHERE id='ultra'`
4. Deploy: git push → VPS pull → pm2 restart
5. Kiểm tra hiển thị card Ultra + checkout `?pkg=ultra`