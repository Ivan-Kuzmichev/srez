# Srez

Учёт биржевых бумаг и крипты для одного владельца: журнал операций, портфели, доходность, выплаты, аналитика. Работает на домашнем NAS в Docker. База — один файл SQLite.

Документация для разработки лежит в `docs/`, правила работы — в `CLAUDE.md`, ход работы — в `docs/PROGRESS.md`.

## Что нужно

- Node.js 22.12 или новее (проверено на 24)
- pnpm 10 (`corepack enable` подтянет нужную версию)
- Docker с Compose v2 для запуска в контейнерах

## Локальный запуск

```sh
pnpm install
cp .env.example .env        # заполнить по комментариям в файле
pnpm db:migrate             # создаст data/srez.db и применит миграции
pnpm dev                    # web на http://localhost:3000
pnpm worker:dev             # воркер в соседнем терминале
```

Витрина компонентов: http://localhost:3000/dev/ui (будет удалена перед выпуском).

Логи в терминале в режиме разработки печатаются через pino-pretty. Чтобы получить сырой JSON: `LOG_PRETTY=0`.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | web в режиме разработки |
| `pnpm worker:dev` | воркер с перезапуском при правках |
| `pnpm db:generate` | миграция из изменений схемы в `src/db/schema` |
| `pnpm db:migrate` | применить миграции к `DATABASE_PATH` |
| `pnpm test` | юнит-тесты (Vitest) |
| `pnpm test:e2e` | сквозные тесты (Playwright, 1440 и 390 px); база `data/e2e.db` |
| `pnpm check` | typecheck, lint и юнит-тесты; обязателен перед коммитом |
| `pnpm build` | сборка Next.js (standalone) и бандлов воркера, миграций и CLI в `dist/` |
| `pnpm cli <команда>` | служебные команды (`pnpm cli help`) |

Перед первым `pnpm test:e2e`: `pnpm exec playwright install chromium`.

## Docker

```sh
docker compose up --build
```

Поднимаются два контейнера из одного образа:

- `web` — интерфейс на порту 3000. При старте применяет миграции.
- `worker` — фоновые задачи и расписание. Стартует, когда `web` здоров.

База — файл `./data/srez.db` рядом с `docker-compose.yml`. Его видят оба контейнера.

**Каталог `data` должен лежать на локальном диске хоста.** На сетевой папке (SMB, NFS) блокировки SQLite ненадёжны и база может повредиться. Контейнеры работают от пользователя с uid 1001. На Linux каталог нужно отдать ему: `sudo chown -R 1001:1001 data`.

По умолчанию образ собирается под `linux/amd64` (целевой NAS). На Mac с Apple Silicon для локальной проверки быстрее собрать под свою архитектуру:

```sh
SREZ_PLATFORM=linux/arm64 docker compose up --build
```

Служебные команды в контейнере: `docker compose run --rm web cli <команда>`.

Резервная копия — копия файла базы. Безопасно делать её на ходу так: `sqlite3 data/srez.db ".backup data/backup.db"`. Кнопка и команда для копий появятся в фазе 9.

## Переменные окружения

Полный список с комментариями — в `.env.example`. Всё, что меняется из интерфейса, хранится в базе, а не здесь.

| Переменная | Назначение |
|---|---|
| `DATABASE_PATH` | Путь к файлу SQLite. В Docker всегда `/data/srez.db` |
| `APP_URL` | Публичный адрес. Нужен для кук и пасскеев (с фазы 1) |
| `APP_SECRET_KEY` | Ключ шифрования секретов в базе, `openssl rand -base64 32` |
| `AUTH_SECRET` | Секрет Better Auth, `openssl rand -base64 32` |
| `TRUSTED_PROXIES` | Обратные прокси, которым можно верить в `X-Forwarded-For` |
| `TINVEST_PROXY_URL` | Необязательный прокси для Т-Инвестиций |
| `LOG_LEVEL` | `debug`, `info`, `warn` или `error` |
| `TZ` | Часовой пояс контейнера, по умолчанию `UTC` |

## Проверка, что всё живо

- `GET /api/health` отвечает `{"status":"ok"}`, когда база доступна.
- Раз в минуту воркер выполняет задачу `system.heartbeat` и пишет строку `Worker heartbeat` в таблицу `logs`:

  ```sh
  sqlite3 data/srez.db "select datetime(ts/1000,'unixepoch'), message, job_id from logs order by id desc limit 5"
  ```

Развёртывание на NAS за обратным прокси с HTTPS будет описано в фазе 10.
