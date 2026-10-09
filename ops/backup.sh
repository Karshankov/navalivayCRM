#!/bin/bash
set -e

# Конфигурация
PROJECT_NAME="NAVALIVAY"
PROJECT_DIR="/var/www/${PROJECT_NAME}"
BACKUP_DIR="/var/backups/${PROJECT_NAME}"
RETENTION_DAYS=30  # Хранить бэкапы 30 дней

# Цвета
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Текущая дата и время
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}  Бэкап ${PROJECT_NAME}${NC}"
echo -e "${GREEN}=======================================${NC}"

# Создание директории для бэкапов
mkdir -p "${BACKUP_PATH}"
echo -e "${YELLOW}Директория бэкапа: ${BACKUP_PATH}${NC}"

# 1. Бэкап базы данных
echo -e "\n${YELLOW}[1/3] Бэкап базы данных...${NC}"
DB_FILE="${PROJECT_DIR}/server/data/navalivay.db"
if [ -f "${DB_FILE}" ]; then
    cp "${DB_FILE}" "${BACKUP_PATH}/navalivay.db"
    
    # Экспорт в SQL (опционально)
    if command -v sqlite3 &> /dev/null; then
        sqlite3 "${DB_FILE}" .dump > "${BACKUP_PATH}/navalivay.sql"
        echo -e "${GREEN}✓ БД сохранена (binary + SQL)${NC}"
    else
        echo -e "${GREEN}✓ БД сохранена (binary)${NC}"
    fi
else
    echo -e "${RED}✗ Файл БД не найден: ${DB_FILE}${NC}"
fi

# 2. Бэкап uploads
echo -e "\n${YELLOW}[2/3] Бэкап загрузок...${NC}"
UPLOADS_DIR="${PROJECT_DIR}/uploads"
if [ -d "${UPLOADS_DIR}" ]; then
    UPLOADS_COUNT=$(find "${UPLOADS_DIR}" -type f | wc -l)
    if [ "${UPLOADS_COUNT}" -gt 0 ]; then
        tar -czf "${BACKUP_PATH}/uploads.tar.gz" -C "${PROJECT_DIR}" uploads
        echo -e "${GREEN}✓ Архив создан: ${UPLOADS_COUNT} файлов${NC}"
    else
        echo -e "${YELLOW}! Директория uploads пуста${NC}"
    fi
else
    echo -e "${RED}✗ Директория uploads не найдена${NC}"
fi

# 3. Бэкап конфигурации
echo -e "\n${YELLOW}[3/3] Бэкап конфигурации...${NC}"
if [ -f "${PROJECT_DIR}/server/.env" ]; then
    cp "${PROJECT_DIR}/server/.env" "${BACKUP_PATH}/.env"
    chmod 600 "${BACKUP_PATH}/.env"
    echo -e "${GREEN}✓ .env сохранен${NC}"
fi

if [ -f "${PROJECT_DIR}/server/data/admin.json" ]; then
    cp "${PROJECT_DIR}/server/data/admin.json" "${BACKUP_PATH}/admin.json"
    echo -e "${GREEN}✓ admin.json сохранен${NC}"
fi

# Userbot session - КРИТИЧНО чувствительна (= ключ к Telegram-аккаунту менеджера).
# Сохраняем в шифрованном виде, если задан BACKUP_GPG_RECIPIENT, иначе
# просто chmod 600 рядом с .env. Без шифрования утечка дампа бэкапа =
# угон аккаунта; с шифрованием — нужен приватный ключ для распаковки.
USERBOT_SESSION="${PROJECT_DIR}/server/data/userbot.session"
if [ -f "${USERBOT_SESSION}" ]; then
    if [ -n "${BACKUP_GPG_RECIPIENT:-}" ] && command -v gpg >/dev/null 2>&1; then
        gpg --batch --yes --trust-model always \
            --encrypt --recipient "${BACKUP_GPG_RECIPIENT}" \
            --output "${BACKUP_PATH}/userbot.session.gpg" \
            "${USERBOT_SESSION}"
        chmod 600 "${BACKUP_PATH}/userbot.session.gpg"
        echo -e "${GREEN}✓ userbot.session сохранён (encrypted, GPG)${NC}"
    else
        cp "${USERBOT_SESSION}" "${BACKUP_PATH}/userbot.session"
        chmod 600 "${BACKUP_PATH}/userbot.session"
        echo -e "${YELLOW}⚠ userbot.session сохранён БЕЗ шифрования${NC}"
        echo -e "${YELLOW}  установи BACKUP_GPG_RECIPIENT и пакет gpg, чтобы шифровать${NC}"
    fi
fi

# proxychains conf - не критично, но удобно держать вместе
if [ -r /etc/proxychains4.conf ]; then
    sudo cp /etc/proxychains4.conf "${BACKUP_PATH}/proxychains4.conf" 2>/dev/null || \
        cp /etc/proxychains4.conf "${BACKUP_PATH}/proxychains4.conf" 2>/dev/null || true
    if [ -f "${BACKUP_PATH}/proxychains4.conf" ]; then
        chmod 600 "${BACKUP_PATH}/proxychains4.conf"
        echo -e "${GREEN}✓ /etc/proxychains4.conf сохранён${NC}"
    fi
fi

# Создание info файла
cat > "${BACKUP_PATH}/backup_info.txt" << EOF
Backup Date: $(date)
Hostname: $(hostname)
Project: ${PROJECT_NAME}
Project Dir: ${PROJECT_DIR}
EOF

# Подсчет размера бэкапа
BACKUP_SIZE=$(du -sh "${BACKUP_PATH}" | cut -f1)
echo -e "\n${GREEN}Размер бэкапа: ${BACKUP_SIZE}${NC}"

# Очистка старых бэкапов
echo -e "\n${YELLOW}Очистка старых бэкапов (старше ${RETENTION_DAYS} дней)...${NC}"
DELETED_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type d -mtime +${RETENTION_DAYS} -exec rm -rf {} \; -print | wc -l)
if [ "${DELETED_COUNT}" -gt 0 ]; then
    echo -e "${GREEN}✓ Удалено старых бэкапов: ${DELETED_COUNT}${NC}"
else
    echo -e "${YELLOW}! Старых бэкапов не найдено${NC}"
fi

# Список доступных бэкапов
echo -e "\n${YELLOW}Доступные бэкапы:${NC}"
ls -lht "${BACKUP_DIR}" | head -n 6

echo -e "\n${GREEN}=======================================${NC}"
echo -e "${GREEN}  Бэкап завершен успешно! ✓${NC}"
echo -e "${GREEN}=======================================${NC}"
echo -e "\n${YELLOW}Путь к бэкапу: ${BACKUP_PATH}${NC}"
echo -e "\n${YELLOW}Восстановление:${NC}"
echo -e "  БД:       ${YELLOW}cp ${BACKUP_PATH}/navalivay.db ${DB_FILE}${NC}"
echo -e "  Uploads:  ${YELLOW}tar -xzf ${BACKUP_PATH}/uploads.tar.gz -C ${PROJECT_DIR}${NC}"
