#!/bin/sh
set -e

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
