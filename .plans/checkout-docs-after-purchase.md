# Plan: Hiển thị Docs ngay sau khi mua hàng thành công

## Overview
Khi khách thanh toán thành công trên trang checkout, hiển thị hướng dẫn (Google Docs) ngay bên dưới khối "Thanh toán thành công" để khách xem luôn mà không cần bấm thêm nút.

## File thay đổi
- `checkout.html` - Thêm section docs bên dưới `#paySuccess` trong step 3

---

## Step 1: Thêm section docs (HTML)

Chèn sau thẻ đóng của `#paySuccess` (dòng ~128), bên trong `#step3`:

```html
<!-- Hướng dẫn sử dụng - hiện sau khi thanh toán thành công -->
<div id="docsSection" class="hidden space-y-3">
  <div class="bg-dark-700 border border-primary/20 rounded-2xl overflow-hidden">
    <div class="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 bg-primary/20 rounded-xl flex items-center justify-center text-lg">📘</div>
        <div>
          <h3 class="font-bold text-sm">Hướng dẫn sử dụng</h3>
          <p class="text-xs text-gray-500">Xem ngay để setup và dùng API key</p>
        </div>
      </div>
      <a href="https://docs.google.com/document/d/1SxUBLR7-Ewpkoki0t2dUy8k25WEue-bY_Vqag8Fur1s/edit?tab=t.0"
         target="_blank" rel="noopener noreferrer"
         class="shrink-0 px-4 py-2 bg-primary hover:bg-primary/90 rounded-xl text-xs font-semibold transition">
        Mở Google Docs ↗
      </a>
    </div>
    <iframe id="docsIframe"
      src="https://docs.google.com/document/d/1SxUBLR7-Ewpkoki0t2dUy8k25WEue-bY_Vqag8Fur1s/preview"
      class="w-full bg-white" style="height:480px" title="Hướng dẫn sử dụng"
      loading="lazy"></iframe>
  </div>
</div>
```

## Step 2: Hiện docs khi thanh toán thành công

Trong `startPolling()`, khi `data.status === "paid"`, thêm dòng hiện section docs:

```js
document.getElementById("docsSection").classList.remove("hidden");
```

Thêm vào ngay sau dòng `document.getElementById("paySuccess").classList.remove("hidden");` (~dòng 389).

Ngoài ra, cuộn nhẹ xuống docs để khách thấy ngay:

```js
setTimeout(() => {
  document.getElementById("docsSection").scrollIntoView({ behavior: "smooth", block: "start" });
}, 300);
```

## Step 3: Dự phòng khi iframe không load được

- Google Docs chỉ embed được khi tài liệu đang ở chế độ "Anyone with the link" (public).
- Nếu iframe trắng, khách vẫn có nút "Mở Google Docs ↗" để mở tab mới.
- Nếu muốn chắc chắn, có thể thêm fallback: hiện link dạng text ngay dưới iframe.

---

## Ghi chú / Quyết định cần xác nhận
1. **Embed iframe**: dùng URL `/preview` thay vì `/edit?tab=t.0` (vì `/edit` không embed được). Cần tài liệu Google Docs ở chế độ public.
2. **Vị trí**: hiện docs ngay dưới `#paySuccess` trong step 3, giữ nguyên Codex onboarding modal hiện tại (modal đó đã có nút "Mở Google Docs").
3. **Scroll**: sau khi docs hiện, tự cuộn xuống để khách thấy ngay.

## Implementation Steps
1. Thêm `#docsSection` HTML vào `checkout.html`
2. Sửa `startPolling()` hiện section + scroll xuống khi paid
3. Test luồng: tạo đơn → thanh toán (mock paid) → docs hiện bên dưới
4. Deploy lên VPS (git push + pull + pm2 restart)