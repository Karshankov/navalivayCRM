#!/bin/bash

# Мониторинг состояния NAVALIVAY

# Цвета
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   NAVALIVAY Статус системы             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/check-prod-runtime.sh" ]; then
    echo -e "${YELLOW}[0] Runtime topology (docs/DEPLOY_REBUILD_RESTART.md):${NC}"
    if bash "${SCRIPT_DIR}/check-prod-runtime.sh"; then
        echo ""
    else
        echo -e "  ${RED}Есть расхождения — см. выше${NC}\n"
    fi
fi

# 1. Статус systemd сервисов
echo -e "${YELLOW}[1] Systemd сервисы:${NC}"
for service in navalivay-server; do
    if ! systemctl list-unit-files --type=service --no-legend | awk '{print $1}' | grep -qx "${service}.service"; then
        echo -e "  $service: ${YELLOW}! Не установлен${NC}"
        continue
    fi

    if systemctl is-active --quiet $service; then
        status="${GREEN}✓ Активен${NC}"
        uptime=$(systemctl show $service --property=ActiveEnterTimestamp --value)
    else
        status="${RED}✗ Неактивен${NC}"
        uptime="N/A"
    fi
    echo -e "  $service: $status"
    if [ "$uptime" != "N/A" ]; then
        echo -e "    Запущен: $(date -d "$uptime" '+%Y-%m-%d %H:%M:%S')"
    fi
done

# 2. API Health Check
echo -e "\n${YELLOW}[2] API Health Check:${NC}"
if curl -sf http://127.0.0.1:8082/api/health > /dev/null 2>&1; then
    response=$(curl -s http://127.0.0.1:8082/api/health)
    echo -e "  ${GREEN}✓ API отвечает${NC}"
    echo -e "  Response: $response"
else
    echo -e "  ${RED}✗ API не отвечает${NC}"
fi

# 3. Использование ресурсов
echo -e "\n${YELLOW}[3] Использование ресурсов:${NC}"
if pgrep -f "node.*index.js" > /dev/null; then
    server_pid=$(pgrep -f "node.*index.js")
    cpu_usage=$(ps -p $server_pid -o %cpu --no-headers 2>/dev/null | tr -d ' ')
    mem_usage=$(ps -p $server_pid -o %mem --no-headers 2>/dev/null | tr -d ' ')
    echo -e "  Server (PID: $server_pid)"
    echo -e "    CPU: ${cpu_usage}% | RAM: ${mem_usage}%"
fi

if pgrep -f "node.*bot.js" > /dev/null; then
    bot_pid=$(pgrep -f "node.*bot.js")
    cpu_usage=$(ps -p $bot_pid -o %cpu --no-headers 2>/dev/null | tr -d ' ')
    mem_usage=$(ps -p $bot_pid -o %mem --no-headers 2>/dev/null | tr -d ' ')
    echo -e "  Bot (PID: $bot_pid)"
    echo -e "    CPU: ${cpu_usage}% | RAM: ${mem_usage}%"
fi

# 4. Диск
echo -e "\n${YELLOW}[4] Использование диска:${NC}"
if [ -d "/var/www/NAVALIVAY" ]; then
    total_size=$(du -sh /var/www/NAVALIVAY 2>/dev/null | cut -f1)
    uploads_size=$(du -sh /var/www/NAVALIVAY/uploads 2>/dev/null | cut -f1)
    uploads_count=$(find /var/www/NAVALIVAY/uploads -type f 2>/dev/null | wc -l)
    db_size=$(du -sh /var/www/NAVALIVAY/server/data/*.db 2>/dev/null | cut -f1)
    
    echo -e "  Проект: ${total_size}"
    echo -e "  Uploads: ${uploads_size} (${uploads_count} файлов)"
    echo -e "  БД: ${db_size}"
fi

# 5. Последние логи (если есть ошибки)
echo -e "\n${YELLOW}[5] Последние ошибки в логах:${NC}"
errors=$(journalctl -u navalivay-server --since "1 hour ago" -p err --no-pager 2>/dev/null | wc -l)
if [ "$errors" -gt 0 ]; then
    echo -e "  ${RED}⚠ Найдено ошибок за последний час: ${errors}${NC}"
    echo -e "  Последние 3 ошибки:"
    journalctl -u navalivay-server --since "1 hour ago" -p err --no-pager -n 3 2>/dev/null | sed 's/^/    /'
else
    echo -e "  ${GREEN}✓ Ошибок не обнаружено${NC}"
fi

echo -e "  ${YELLOW}PM2 bot (последние error-строки):${NC}"
pm2 logs navalivay-bot --err --lines 3 --nostream 2>/dev/null | sed 's/^/    /' || true
echo -e "  ${YELLOW}PM2 userbot (последние error-строки):${NC}"
pm2 logs navalivay-userbot --err --lines 3 --nostream 2>/dev/null | sed 's/^/    /' || true

# 6. Nginx
echo -e "\n${YELLOW}[6] Nginx:${NC}"
if systemctl is-active --quiet nginx; then
    echo -e "  ${GREEN}✓ Nginx активен${NC}"
    if [ -f "/var/log/nginx/navalivay_error.log" ]; then
        nginx_errors=$(tail -n 100 /var/log/nginx/navalivay_error.log 2>/dev/null | wc -l)
        echo -e "  Последние записи в error.log: ${nginx_errors}"
    fi
else
    echo -e "  ${RED}✗ Nginx неактивен${NC}"
fi

# 7. Последний бэкап
echo -e "\n${YELLOW}[7] Последний бэкап:${NC}"
if [ -d "/var/backups/NAVALIVAY" ]; then
    last_backup=$(ls -t /var/backups/NAVALIVAY 2>/dev/null | head -n 1)
    if [ -n "$last_backup" ]; then
        backup_date=$(stat -c %y "/var/backups/NAVALIVAY/$last_backup" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
        echo -e "  ${GREEN}✓ $last_backup${NC}"
        echo -e "    Дата: $backup_date"
    else
        echo -e "  ${YELLOW}! Бэкапов не найдено${NC}"
    fi
else
    echo -e "  ${YELLOW}! Директория бэкапов не создана${NC}"
fi

# 8. Сетевые подключения
echo -e "\n${YELLOW}[8] Активные подключения:${NC}"
connections=$(netstat -an 2>/dev/null | grep :8082 | grep ESTABLISHED | wc -l)
echo -e "  Активных соединений на порту 8082: ${connections}"

echo -e "\n${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}Полезные команды:${NC}"
echo -e "  Логи API:     ${YELLOW}./ops/prod.sh logs api${NC}"
echo -e "  Логи бота:    ${YELLOW}./ops/prod.sh logs bot${NC}"
echo -e "  Рестарт API:  ${YELLOW}./ops/prod.sh restart api${NC}"
echo -e "  Рестарт бота: ${YELLOW}./ops/prod.sh restart bot${NC}"
echo -e "  Runtime check:${YELLOW}./ops/prod.sh doctor${NC}"
echo -e "  Деплой:       ${YELLOW}docs/DEPLOY_REBUILD_RESTART.md${NC}"
echo -e "  Бэкап:        ${YELLOW}./ops/backup.sh${NC}"
