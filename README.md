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
cp .env.example .env                    # заполнить по комментариям в файле
pnpm db:migrate                         # создаст ~/.srez/dev.db и применит миграции
pnpm cli user:create --username admin   # пароль спросит дважды, не короче 12 символов
pnpm dev                                # web на http://localhost:3000
pnpm worker:dev                         # воркер в соседнем терминале
```

В разработке база по умолчанию лежит в `~/.srez/dev.db`, а не в проекте: Turbopack следит за всем каталогом проекта и перезагружает страницу при каждой записи в файл базы. Другой путь задаётся `DATABASE_PATH`.

Регистрации нет. Пользователь создаётся командой, пароль сбрасывается тоже командой:

```sh
pnpm cli user:reset-password --username admin                  # новый пароль, все сессии завершатся
pnpm cli user:reset-password --username admin --disable-2fa    # заодно отключить 2FA
pnpm cli user:reset-password --username admin --remove-passkeys
```

Пасскеи работают на `http://localhost` и по HTTPS с доменным именем. По IP-адресу или по HTTP с другого устройства кнопки пасскея скрыты.

Логи в терминале в режиме разработки печатаются через pino-pretty. Чтобы получить сырой JSON: `LOG_PRETTY=0`.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | web в режиме разработки |
| `pnpm worker:dev` | воркер с перезапуском при правках |
| `pnpm db:generate` | миграция из изменений схемы в `src/db/schema` |
| `pnpm db:migrate` | применить миграции к `DATABASE_PATH` |
| `pnpm test` | юнит-тесты (Vitest) |
| `pnpm test:e2e` | сквозные тесты (Playwright: Chromium на 1440 и 390, Firefox, Safari, iPhone); база `data/e2e.db`, после прогона — проверка, что секретов в базе нет |
| `pnpm check` | typecheck, lint и юнит-тесты; обязателен перед коммитом |
| `pnpm build` | сборка Next.js (standalone) и бандлов воркера, миграций и CLI в `dist/` |
| `pnpm cli <команда>` | служебные команды (`pnpm cli help`): `user:create`, `user:reset-password`, `db:backup` |
| `pnpm auth:generate` | пересоздать таблицы Better Auth в `src/db/schema/auth.ts` после смены его настроек, затем `pnpm db:generate` |

Перед первым `pnpm test:e2e`: `pnpm exec playwright install chromium firefox webkit`. Основные сценарии идут в Chromium на 1440 и 390, главный путь — ещё в Firefox, Safari (WebKit) и Safari на iPhone.

## Развёртывание на NAS

Нужно: Docker с Compose v2, место на **локальном** диске NAS (не сетевая папка: на SMB и NFS блокировки SQLite ненадёжны) и, для входа по пасскею, доменное имя с HTTPS. Всё остальное — в образе.

### 1. Код и каталог данных

```sh
git clone <адрес репозитория> srez && cd srez
mkdir -p data
sudo chown -R 1001:1001 data        # контейнеры работают от uid 1001
```

### 2. Настройки

```sh
cp .env.example .env
openssl rand -base64 32             # → APP_SECRET_KEY
openssl rand -base64 32             # → AUTH_SECRET
```

В `.env` заполните:

- `APP_URL` — адрес, по которому вы открываете сервис, например `https://invest.example.ru`. От него зависят куки и пасскеи: по `http://` и по IP-адресу пасскеи не работают, вход по паролю и 2FA — работают.
- `APP_SECRET_KEY` и `AUTH_SECRET` — сгенерированные выше значения. **Сохраните `APP_SECRET_KEY` вместе с резервными копиями**: без него токены в копии не расшифровать.
- `TZ` — часовой пояс контейнера, например `Europe/Moscow` (часовой пояс отображения задаётся в интерфейсе).
- `TRUSTED_PROXIES` и `SREZ_BIND` — см. шаг 5.

### 3. Сборка и запуск

```sh
docker compose up -d --build
```

Образ по умолчанию собирается под `linux/amd64` (Intel/AMD NAS). Для NAS на ARM: `SREZ_PLATFORM=linux/arm64 docker compose up -d --build`.

Поднимаются два контейнера из одного образа:

- `web` — интерфейс на порту 3000; при старте применяет миграции базы. Здоровье: `docker compose ps` показывает `healthy`, `curl http://127.0.0.1:3000/api/health` отвечает `{"status":"ok"}`.
- `worker` — фоновые задачи и расписание: синхронизация, цены, снимки, начисления, уведомления. Стартует, когда `web` здоров.

База — файл `./data/srez.db`.

### 4. Первый пользователь

```sh
docker compose run --rm web cli user:create --username admin
```

Пароль спросит дважды, не короче 12 символов. Регистрации нет; забытый пароль сбрасывается так же командой (см. «Локальный запуск»). Дальше — вход в браузере и подключение источников в интерфейсе.

### 5. Обратный прокси и HTTPS

Порт 3000 по умолчанию слушается только на `127.0.0.1`: снаружи до него не достучаться, пока перед ним не встанет прокси с HTTPS.

**Прокси на той же машине** (оставьте `SREZ_BIND` пустым, `TRUSTED_PROXIES=127.0.0.1`). Caddy сам получит сертификат:

```
invest.example.ru {
    reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name invest.example.ru;
    ssl_certificate     /etc/ssl/invest.example.ru.crt;
    ssl_certificate_key /etc/ssl/invest.example.ru.key;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

На Synology встроенный прокси: «Панель управления → Портал входа → Дополнительно → Обратный прокси», источник HTTPS на ваш домен, назначение `http://localhost:3000`.

**Прокси на другой машине**: `SREZ_BIND=0.0.0.0`, в `TRUSTED_PROXIES` — адрес прокси (можно CIDR, через запятую), в прокси — `http://<адрес NAS>:3000`. Закройте порт 3000 от остальной сети файрволом NAS: доверие к `X-Forwarded-For` дано только адресам из `TRUSTED_PROXIES`.

После смены `.env`: `docker compose up -d`. Когда `APP_URL` начинается с `https://`, сервис добавляет заголовок HSTS.

### 6. Резервные копии

- Кнопка «Скачать резервную копию» в «Настройки → Общие → Данные».
- Команда: `docker compose run --rm web cli db:backup` — копия ляжет в `./data/backups/srez-backup-<дата-время>.db`. Копия целостная, её можно делать на ходу; активные сессии из неё вычищены, ключи и токены внутри зашифрованы.

По расписанию — раз в день из планировщика NAS (на Synology: «Планировщик задач → Пользовательский скрипт») или cron:

```sh
cd /volume1/docker/srez && docker compose run --rm web cli db:backup \
  && find data/backups -name 'srez-backup-*.db' -mtime +30 -delete
```

Копируйте `data/backups` на другой диск или в облако и храните `APP_SECRET_KEY` отдельно от копий.

### 7. Восстановление из копии

```sh
docker compose down
cp data/backups/srez-backup-2026-10-09-03-00.db data/srez.db
rm -f data/srez.db-wal data/srez.db-shm
docker compose up -d
```

Нужен тот же `APP_SECRET_KEY`, что был при создании копии. Сессии в копии не сохраняются: после восстановления войдите заново.

### 8. Обновление

```sh
docker compose run --rm web cli db:backup     # на всякий случай
git pull
docker compose up -d --build
```

Миграции применяются при старте `web`, только вперёд. Логи: `docker compose logs -f web worker`; подробные — в интерфейсе, «Разработка → Логи».

### Docker локально

На Mac с Apple Silicon: `SREZ_PLATFORM=linux/arm64 docker compose up --build`. Служебные команды в контейнере: `docker compose run --rm web cli <команда>`.

## Переменные окружения

Полный список с комментариями — в `.env.example`. Всё, что меняется из интерфейса, хранится в базе, а не здесь.

| Переменная | Назначение |
|---|---|
| `DATABASE_PATH` | Путь к файлу SQLite. В Docker всегда `/data/srez.db` |
| `APP_URL` | Публичный адрес. Нужен для кук и пасскеев; `https://` включает HSTS |
| `APP_SECRET_KEY` | Ключ шифрования секретов в базе (токен Т-Инвестиций и другие), `openssl rand -base64 32`. Обязателен в production. Сохраните его вместе с резервной копией базы: без него токены не расшифровать и их придётся ввести заново |
| `AUTH_SECRET` | Секрет Better Auth, `openssl rand -base64 32` |
| `TRUSTED_PROXIES` | Обратные прокси, которым можно верить в `X-Forwarded-For` |
| `TINVEST_PROXY_URL` | Необязательный прокси для Т-Инвестиций |
| `LOG_LEVEL` | `debug`, `info`, `warn` или `error` |
| `TZ` | Часовой пояс контейнера, по умолчанию `UTC` |
| `SREZ_BIND` | На каком адресе хоста слушать порт 3000: пусто — только `127.0.0.1`, `0.0.0.0` — для прокси на другой машине |
| `SREZ_PLATFORM` | Архитектура образа: `linux/amd64` (по умолчанию) или `linux/arm64` |

## Проверка, что всё живо

- `GET /api/health` отвечает `{"status":"ok"}`, когда база доступна.
- Раз в минуту воркер выполняет задачу `system.heartbeat` (строка в логах — только на уровне `debug`). Последний пульс:

  ```sh
  sqlite3 data/srez.db "select status, datetime(finished_at/1000,'unixepoch') from jobs where name='system.heartbeat' order by id desc limit 1"
  ```


## Нагрузочная проверка

```sh
export DATABASE_PATH=/tmp/srez-perf.db
pnpm db:migrate
pnpm cli user:create --username owner
pnpm exec tsx scripts/perf/generate.ts owner        # 20 000 операций, 5 лет цен и снимков
pnpm build && pnpm start -p 3400                    # в другом терминале
node scripts/perf/measure.mjs http://localhost:3400 owner '<пароль>'
```
