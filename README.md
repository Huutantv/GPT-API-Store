# Doro Proxy

Deploy nhanh qua GitHub -> VPS bằng Docker Compose.

## 1. Day code len GitHub

```bash
git add .
git commit -m "Prepare VPS deploy"
git push origin main
```

## 2. Deploy lan dau tren VPS

```bash
sudo apt update && sudo apt install -y curl
curl -O https://raw.githubusercontent.com/Huutantv/AI/main/deploy.sh
bash deploy.sh https://github.com/Huutantv/AI.git main
```

Script se:

- cai `git`
- cai `docker` va `docker compose`
- clone repo tu GitHub
- tao `.env` tu `.env.example` neu chua co
- build va chay `docker compose up -d`

Neu script dung lai vi chua co `.env`, sua file:

```bash
nano ~/doro-proxy/.env
```

Sau do chay lai:

```bash
cd ~/doro-proxy
bash deploy.sh https://github.com/Huutantv/AI.git main
```

## 3. Bien moi truong can sua

File `.env`:

```env
DORO_API_KEY=your_real_key
DORO_API_BASE=https://doro.lol/v1
DORO_BACKEND_MODEL=deepseek-v4-pro
DORO_PROXY_KEYS=sk-demo-key-1,sk-demo-key-2
DORO_PROXY_PORT=4000
DORO_PROXY_WORKERS=2
DORO_MAX_CONCURRENT=50
```

## 4. Lenh quan ly tren VPS

```bash
cd ~/doro-proxy
docker compose ps
docker compose logs -f
docker compose restart
curl http://localhost:4000/health
```

## 5. Update sau moi lan push GitHub

```bash
cd ~/doro-proxy
git pull
docker compose up -d --build
```

## 6. Auto deploy bang GitHub Actions

Them GitHub repository secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`

Sau do moi lan push len `main`, GitHub se SSH vao VPS va chay deploy.
