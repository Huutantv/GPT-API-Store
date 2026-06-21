# Hướng Dẫn Cài Đặt Cline / Kilo Code trong VS Code

## 1. Cài extension Cline hoặc Kilo Code
Mở VS Code → **Extensions** → Tìm một trong các extension sau và **Install**:

* **Cline**
* **Kilo Code**

## 2. Mở phần cấu hình Provider
Sau khi cài xong extension:

* **Với Cline**
  * Nhấn biểu tượng Cline ở thanh bên trái → **Settings** hoặc **API Configuration**.
* **Với Kilo Code**
  * Nhấn biểu tượng Kilo Code ở thanh bên trái → **Settings** → mục **Provider / API Provider**.

## 3. Điền thông tin cấu hình
Chọn provider là **OpenAI Compatible** và nhập các thông tin sau:

| Trường | Giá trị |
|---|---|
| **Base URL** | `https://zplay.io.vn/v1` |
| **API Key** | `sk‑your‑api‑key` *(thay `sk‑your‑api‑key` bằng API key thực của bạn)* |
| **Model** | `gpt-5.5` *(có thể chọn một trong các model dưới đây)* |

## 4. Model có thể sử dụng
Bạn có thể chọn một trong các model sau:

* `gpt-5.5` *(khuyến nghị mặc định)*
* `gpt-5.5-turbo`
* `gpt-5.4`
* `gpt-4o`

> **Lưu ý:** Nếu muốn phản hồi nhanh hơn, có thể thử `gpt-5.5-turbo`.

## 5. Bật Streaming (nếu có)
Nếu extension cung cấp tùy chọn **Enable Streaming**, bật để có phản hồi nhanh hơn.

## 6. Lưu cấu hình và kiểm tra
1. Nhấn **Save**.
2. Mở khung chat của Cline hoặc Kilo Code.
3. Gửi một câu thử, ví dụ:

```
Hello, bạn có hoạt động không?
```

Nếu nhận được phản hồi, cấu hình đã thành công.

## 7. Cấu hình mẫu

```
API Provider: OpenAI Compatible
Base URL: https://zplay.io.vn/v1
API Key: sk‑your‑api‑key
Model: gpt-5.5
Enable Streaming: On
```

## ⚠️ Lưu ý quan trọng
* **Phải** chọn **OpenAI Compatible**.
* **Không** chọn **Anthropic**, **OpenAI mặc định**, **Google Gemini**, **OpenRouter** trừ khi hệ thống của bạn có hướng dẫn riêng cho các provider đó.

---

*Thời gian cập nhật: 2026‑06‑22*.
