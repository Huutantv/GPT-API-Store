# Huong Dan Deploy Doro Proxy Len VPS Bang GitHub11



cd ~/doro-proxy

git stash push -u -m "backup local vps changes before github pull"


cd ~/doro-proxy
git pull
docker compose up -d --build

git pull --ff-only origin main

npm install --omit=dev

pm2 restart doro-proxy --update-env



cd ~/doro-proxy
git pull --ff-only origin main
pm2 restart doro-proxy --update-env

Quy trinh moi:

1. Sua code tren may Windows.
2. Push code len GitHub.
3. SSH vao VPS.
4. VPS pull code tu GitHub va rebuild Docker Compose.

Khong can upload tung file bang `scp` nua.

## 1. Phan biet Windows va VPS

Neu terminal hien:

```text
PS E:\AI>
```

ban dang o may Windows.

Neu terminal hien:

```text
root@vpssieutoc:~#
```

ban dang o VPS.

Quy tac:

- Windows chi dung de sua code va `git push`.
- VPS dung de `git pull` va chay `docker compose`.
- Khong chay `docker compose` tren Windows neu Docker Desktop khong duoc dung.
- Khong commit hoac upload de file `.env` dang co key that tren VPS.

## 2. Push code tu Windows len GitHub

Mo PowerShell tren Windows:

```powershell
cd E:\AI
git status
git add .
git commit -m "Update doro proxy"
git push origin main
```

Remote hien tai cua repo:

```text
https://github.com/Huutantv/AI.git
```

Neu chua cau hinh remote:

```powershell
git remote add origin https://github.com/Huutantv/AI.git
git branch -M main
git push -u origin main
```

## 3. Deploy lan dau tren VPS

SSH vao VPS:

```powershell
ssh root@<VPS_IP>
```

Chay tren VPS:

```bash
if command -v sudo >/dev/null 2>&1; then sudo apt update && sudo apt install -y curl; else apt update && apt install -y curl; fi
curl -fsSL -o deploy.sh https://raw.githubusercontent.com/Huutantv/AI/main/deploy.sh
bash deploy.sh https://github.com/Huutantv/AI.git main
```

Script `deploy.sh` se:

- cai `git` neu chua co
- cai Docker va Docker Compose plugin neu chua co
- clone repo ve `~/doro-proxy`
- tao `.env` tu `.env.example` neu chua co
- mo port trong UFW neu UFW dang bat
- build va chay `docker compose up -d --build`

Neu script dung lai vi VPS chua co `.env`, sua file:

```bash
nano ~/doro-proxy/.env
```

Sau do chay lai:

```bash
cd ~/doro-proxy
bash deploy.sh https://github.com/Huutantv/AI.git main
```

## 4. Update VPS sau moi lan push

Sau khi push code moi len GitHub, vao VPS:

```powershell
ssh root@<VPS_IP>
```

Chay:

```bash
cd ~/doro-proxy
git pull --ff-only origin main
docker compose up -d --build
```

Neu muon dung lenh deploy day du, chay:

```bash
cd ~/doro-proxy
bash deploy.sh https://github.com/Huutantv/AI.git main
```

## 5. Backup `.env` tren VPS truoc khi rebuild

File `.env` tren VPS duoc mount vao container tai `/app/.env`, nen config/key sua tren dashboard se duoc ghi vao `~/doro-proxy/.env` va khong mat khi rebuild.

Backup neu can:

```bash
cd ~/doro-proxy
cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
```

## 6. Kiem tra proxy

Tren VPS:

```bash
curl http://127.0.0.1:4000/health
```

## 6.1. Cho phep request anh lon hon 1MB

App Node doc JSON body theo bien `.env`:

```env
DORO_BODY_LIMIT=50mb
```

Anh gui qua API thuong nam trong JSON base64, nen 1MB anh goc se thanh khoang 1.33MB request body. Neu khach gui anh tren 1MB bi loi `413 Payload Too Large`, kiem tra nginx tren VPS:

```bash
nginx -T | grep -i client_max_body_size
```

Neu nginx chua cau hinh size, them vao block `server` hoac `http`:

```nginx
client_max_body_size 50m;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

Sau do reload:

```bash
nginx -t && systemctl reload nginx
cd ~/doro-proxy
docker compose restart doro-proxy
```

Tren may Windows hoac trinh duyet:

```text
http://<VPS_IP>:4000/health
http://<VPS_IP>:4000/dashboard_@@admin
```

## 7. Xem log Docker tren VPS

Chay trong SSH tren VPS:

```bash
cd ~/doro-proxy
docker compose ps
docker compose logs -f doro-proxy
```

Neu can restart:

```bash
docker compose restart doro-proxy
```

## 8. Auto deploy bang GitHub Actions

Repo da co file:

```text
.github/workflows/deploy.yml
```

Them 3 secret trong GitHub repo:

- `VPS_HOST`: IP hoac domain cua VPS
- `VPS_USER`: user SSH, vi du `root`
- `VPS_SSH_KEY`: private key SSH co quyen vao VPS

Sau do moi lan push len `main`, GitHub Actions se SSH vao VPS, pull code moi tu GitHub va chay `deploy.sh`.

## 9. Test request tu Windows

Dung PowerShell:

```powershell
$body = @{
  model = "claude-sonnet-4-6"
  max_tokens = 16
  messages = @(
    @{
      role = "user"
      content = "ping from windows"
    }
  )
} | ConvertTo-Json -Depth 10 -Compress

Invoke-RestMethod -Uri "http://<VPS_IP>:4000/v1/messages" `
  -Method Post `
  -Headers @{ Authorization = "Bearer sk-user1-abc123" } `
  -ContentType "application/json" `
  -Body $body
```

## 10. Loi thuong gap

### `dockerDesktopLinuxEngine: The system cannot find the file specified`

Ban dang chay Docker tren Windows. Hay SSH vao VPS roi chay Docker o VPS.

### `Cannot find path E:\root\doro-proxy`

Ban dang chay lenh VPS tren Windows. Hay SSH vao VPS truoc:

```powershell
ssh root@<VPS_IP>
```

### `git pull` bao conflict tren VPS

Thuong la do da sua file code truc tiep tren VPS. Nen chi sua code tren Windows, push GitHub, roi VPS pull ve.

Neu chi co file `.env` thay doi thi khong sao, vi `.env` khong duoc Git theo doi.

### URL khong chay trong terminal

URL khong phai lenh shell. Trong terminal dung `curl`:

```bash
curl http://<VPS_IP>:4000/health
```

Con trong trinh duyet thi mo:

```text
http://<VPS_IP>:4000/health
```
