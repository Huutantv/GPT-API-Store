#!/bin/bash
# Backup credit.db hàng ngày (PM2 + Docker volume).
# PM2/local : $HOME/gpt-api-store/credit.db  (hoặc $DORO_DB_PATH nếu set)
# Docker    : volume `proxy-data` (DB tại /app/data/credit.db trong container)
set -u
BACKUP_DIR="$HOME/gpt-api-store/backups"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d-%H%M%S)

# 1. PM2/local (bỏ qua nếu không có file)
SRC="${DORO_DB_PATH:-$HOME/gpt-api-store/credit.db}"
if [ -f "$SRC" ]; then
  cp "$SRC" "$BACKUP_DIR/credit-$DATE.db"
  echo "Backup done (local): credit-$DATE.db"
else
  echo "Skip local backup (not found: $SRC)"
fi

# 2. Docker volume (bỏ qua nếu container không chạy)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  CID=$(docker compose -f "$HOME/doro-proxy/docker-compose.yml" ps -q doro-proxy 2>/dev/null)
  if [ -n "$CID" ]; then
    # Copy cả 3 file (db + wal + shm) để backup WAL-mode nhất quán
    for suffix in "" "-wal" "-shm"; do
      docker cp "$CID:/app/data/credit.db$suffix" "$BACKUP_DIR/credit-docker-$DATE.db$suffix" 2>/dev/null || true
    done
    if [ -f "$BACKUP_DIR/credit-docker-$DATE.db" ]; then
      echo "Backup done (docker): credit-docker-$DATE.db"
    else
      echo "Docker backup failed (DB not found in container)"
    fi
  else
    echo "Skip docker backup (container not running)"
  fi
else
  echo "Skip docker backup (docker compose not found)"
fi

# Giữ 7 ngày gần nhất
find "$BACKUP_DIR" -name "credit-*.db" -mtime +7 -delete
echo "OK"
