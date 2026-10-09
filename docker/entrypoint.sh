#!/bin/sh
set -e

DATA_DIR=$(dirname "${DATABASE_PATH:-/data/srez.db}")

# Started as root (the default): Docker often creates the data folder itself, owned by root, or the
# NAS share belongs to another user. Hand the folder to the app user, then drop root for good.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u "$DATA_DIR")" != "1001" ]; then
    chown -R 1001:1001 "$DATA_DIR" 2>/dev/null || true
  fi
  exec setpriv --reuid=1001 --regid=1001 --init-groups "$0" "$@"
fi

# Started as another user (compose `user:`): it must be able to write there.
if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  echo "Каталог данных $DATA_DIR недоступен для записи пользователю $(id -u):$(id -g)." >&2
  echo "Отдайте его этому пользователю (chown -R $(id -u):$(id -g) data) или уберите user: из docker-compose.yml." >&2
  exit 1
fi
rm -f "$DATA_DIR/.write-test"

case "$1" in
  web)
    node dist/migrate.mjs
    # The socket address for client-address checks (docs/06-api.md, section 3).
    exec node --import ./scripts/remote-address.mjs server.js
    ;;
  worker)
    exec node dist/worker.mjs
    ;;
  cli)
    shift
    exec node dist/cli.mjs "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
