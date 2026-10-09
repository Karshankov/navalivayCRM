# Установленные внешние навыки (2026-10-09)

Источник подбора: каталоги `docs/external-skills/КАТАЛОГ_*.md` (редакция 2026-10-06).
Установка: `~/.claude/skills/` — личная папка навыков агента, в git проекта не попадает.

## Установлено и активно

| Навык | Источник | Лицензия | Когда применять |
|---|---|---|---|
| `playwright-cli` | github.com/microsoft/playwright-cli | — | Браузерная проверка собранного UI: клик по канбану, модалки, скриншоты целевых размеров. Требует запущенного dev-сервера (`npm run dev`). CLI установлен глобально: `playwright-cli` v0.1.22 |
| `apple-design` | github.com/emilkowalski/skills | MIT | Drag-and-drop канбана, прерываемые анимации, spring, reduced-motion, типографика |
| `animate` | там же | MIT | Построение анимаций «с нуля»: длительность, easing, свойства, interrupt |
| `improve-animations` | там же | MIT | Аудит существующих анимаций в коде |
| `impeccable` | github.com/pbakaus/impeccable | Apache-2.0 | Итоговый UX-разбор: 61 правило против типичных AI-паттернов, команды critique/audit/polish/harden. CLI — самодостаточный бинарник в `skills/impeccable/scripts/` |
| `verification-before-completion` | github.com/obra/superpowers | MIT | Дисциплина: никаких заявлений «готово» без свежего прогона проверки — усиливает п.7 workflow из AGENTS.md |
| `test-driven-development` | там же | MIT | Сначала тест, потом код — для новых функций |
| `debugging-and-error-recovery` | github.com/addyosmani/agent-skills | MIT | Системный разбор поломок: триаж, корневая причина, без гадания — для инцидентов и падений тестов |
| `code-review-and-quality` | там же | MIT | Мультиосевой code-review (корректность/читаемость/архитектура/безопасность/производительность) — усиливает цикл «до нуля подтверждённых замечаний» |

## Осознанно НЕ установлено

- **UI UX Pro Max** — база стилей/палитр/шрифтов. У проекта уже есть канонический
  `docs/frontend-design-reference-for-agents.md`, и по его правилам существующий UI —
  источник истины. Установить при проектировании нового экрана «с нуля».
- **Mobile Automation (mobile-mcp)** — нужен MCP-сервер и подключённый телефон.
  Отложено до регулярной мобильной QA-проверки.
- Маркетинг/SEO/реклама/видео/Obsidian — не профиль проекта (сайт под noindex,
  канал — Telegram Mini App; база знаний — `docs/` в git).

## Совместимость с процессом проекта

Навыки не заменяют `docs/development-workflow-for-agents.md`, а усиливают его этапы:
4 (реализация + тесты) ← TDD; 5 (параллельные проверки) ← code-review-and-quality +
impeccable (UX) + playwright-cli (фактический интерфейс); 7 (финальный прогон) ←
verification-before-completion. Apple-design/animate — для задач интерфейса с
drag-and-drop и анимациями (канбан, модалки).

Обновлять: пересобрать из первичных репозиториев и перезаписать папки в `~/.claude/skills/`.
