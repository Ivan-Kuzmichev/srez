#!/bin/sh
set -e

DATA_DIR=$(dirname "${DATABASE_PATH:-/data/srez.db}")

# Can uid:gid write into the data folder? Checked by actually writing as that user.
can_write() {
  setpriv --reuid="$1" --regid="$2" --clear-groups sh -c "touch '$DATA_DIR/.write-test' && rm -f '$DATA_DIR/.write-test'" 2>/dev/null
}

# Started as root (the default). NAS folders come owned by root (created by Docker), by a NAS user,
# or behind ACLs and NFS root_squash where chown does nothing. Pick the first user that can really
# write there: PUID/PGID if given, the app user 1001 (after a chown), the folder's owner; root last.
if [ "$(id -u)" = "0" ] && [ -z "$SREZ_DROPPED" ]; then
  export SREZ_DROPPED=1
  mkdir -p "$DATA_DIR"
  if [ -n "$PUID" ]; then
    if can_write "$PUID" "${PGID:-$PUID}"; then exec setpriv --reuid="$PUID" --regid="${PGID:-$PUID}" --clear-groups "$0" "$@"; fi
    echo "Srez: PUID=$PUID cannot write to $DATA_DIR, trying other users" >&2
  fi
  # May do nothing (ACLs, NFS root_squash, no CHOWN capability): never fatal, the write test decides.
  if [ "$(stat -c %u "$DATA_DIR")" != "1001" ]; then chown -R 1001:1001 "$DATA_DIR" 2>/dev/null || true; fi
  if can_write 1001 1001; then exec setpriv --reuid=1001 --regid=1001 --clear-groups "$0" "$@"; fi
  OWNER_UID=$(stat -c %u "$DATA_DIR")
  OWNER_GID=$(stat -c %g "$DATA_DIR")
  if [ "$OWNER_UID" != "0" ] && can_write "$OWNER_UID" "$OWNER_GID"; then
    echo "Srez: $DATA_DIR belongs to $OWNER_UID:$OWNER_GID and cannot be given to 1001; running as its owner" >&2
    exec setpriv --reuid="$OWNER_UID" --regid="$OWNER_GID" --clear-groups "$0" "$@"
  fi
  echo "Srez: no regular user can write to $DATA_DIR (owner $OWNER_UID:$OWNER_GID); running as root." >&2
  echo "Srez: set PUID and PGID in .env to a user that owns the folder to avoid this." >&2
  exec "$0" "$@"
fi

# Started as a given user (compose `user:`): it must be able to write there.
if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  echo "Каталог данных $DATA_DIR недоступен для записи пользователю $(id -u):$(id -g) (владелец $(stat -c %u:%g "$DATA_DIR"))." >&2
  echo "Задайте в .env PUID и PGID владельца каталога или отдайте каталог этому пользователю: chown -R $(id -u):$(id -g) data" >&2
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
