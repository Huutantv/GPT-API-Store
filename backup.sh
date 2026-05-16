#!/bin/bash
# Backup credit.db hàng ngày
BACKUP_DIR="$HOME/gpt-api-store/backups"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d-%H%M%S)
cp "$HOME/gpt-api-store/credit.db" "$BACKUP_DIR/credit-$DATE.db"
# Giữ 7 ngày gần nhất
find "$BACKUP_DIR" -name "credit-*.db" -mtime +7 -delete
echo "Backup done: credit-$DATE.db"
