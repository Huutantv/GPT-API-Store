# Bao Cao Mau

Dung mau nay cho cac bao cao ky thuat gui noi bo hoac gui khach hang.

## Nguyen tac

- Gon, di thang vao ket qua
- Co emoji de de scan
- Khong lo JSON, tool trace, log noi bo, `to=...`, hoac debug output
- Neu co lenh, tach rieng thanh block de de copy
- Moi bullet chi nen chua 1 y

## Emoji quy uoc

- `📋` Tien do / trang thai
- `✅` Hoan thanh
- `⏳` Dang xu ly
- `⚠️` Co van de / can luu y
- `🔎` Ket qua / chan doan
- `🛠️` Buoc tiep theo
- `📌` Lenh can chay
- `📁` Pham vi / file / moi truong

## Mau ngan

```text
📋 Trạng Thái
- ✅ Dịch vụ đã chạy
- ✅ Health check thành công
- ⚠️ Backend đang trả 503

🔎 Kết Luận
- Proxy hoạt động bình thường
- Lỗi hiện tại nằm ở backend upstream, không phải VPS

🛠️ Bước Tiếp Theo
- Kiểm tra backend key
- Kiểm tra model đang map
- Giảm tải concurrent để test lại

📌 Lệnh Kiểm Tra
curl http://localhost:4000/health
sudo docker compose logs --tail=100 doro-proxy
```

## Mau day du

```text
📋 Tiến Độ
- ✅ Đã hoàn thành bước 1
- ✅ Đã hoàn thành bước 2
- ⏳ Đang xử lý bước 3
- ⚠️ Có lỗi ở bước 4

📁 Phạm Vi
- File liên quan: `doro_proxy.py`, `.env`, `docker-compose.yml`
- Môi trường: `VPS`, `Docker`

🔎 Kết Quả
- Proxy đang chạy bình thường
- Health check trả về thành công
- Backend upstream bị lỗi `503 Service Unavailable`

🛠️ Việc Cần Làm Tiếp
- Giảm `DORO_MAX_CONCURRENT`
- Kiểm tra lại backend key
- Test lại với `stream=false`

📌 Lệnh Cần Chạy
cd ~/doro-proxy
sudo docker compose ps
curl http://localhost:4000/health
sudo docker compose logs --tail=100 doro-proxy
```

## Quy tac viet bao cao

### Nen

- Noi ro ket qua truoc, chi tiet sau
- Neu loi, noi ro loi nam o dau: app, VPS, Docker, hay backend
- Neu dua lenh, dua dung lenh cu the co the copy
- Neu chua xac minh duoc, ghi ro la chua xac minh

### Khong nen

- Khong dan JSON tool call
- Khong dan trace noi bo tru khi can trich 1 dong loi chinh
- Khong viet qua dai neu chi can 3-5 dong la du
- Khong dung nested bullet

## Mau cho tinh huong pho bien

### 1. Bao cao fix xong

```text
📋 Trạng Thái
- ✅ Đã sửa lỗi khởi động service
- ✅ Container đã chạy lại thành công

🔎 Kết Quả
- Ứng dụng hoạt động bình thường
- Health check trả về `ok`

📌 Lệnh Kiểm Tra
curl http://localhost:4000/health
```

### 2. Bao cao dang loi backend

```text
📋 Trạng Thái
- ✅ Proxy đang chạy
- ⚠️ Backend upstream đang lỗi

🔎 Kết Luận
- Lỗi không nằm ở VPS hay Docker
- Backend trả `503 Service Unavailable`

🛠️ Bước Tiếp Theo
- Kiểm tra key backend
- Kiểm tra model backend
- Test lại khi tải thấp hơn
```

### 3. Bao cao can user chay lenh

```text
📋 Trạng Thái
- ✅ Đã cập nhật cấu hình
- ⏳ Cần chạy lại service để áp dụng

📌 Lệnh Cần Chạy
cd ~/doro-proxy
sudo docker compose up -d --build
sudo docker compose logs --tail=50 doro-proxy
```
