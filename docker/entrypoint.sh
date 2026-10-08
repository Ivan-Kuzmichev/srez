#!/bin/sh
set -e

case "$1" in
  web)
    node dist/migrate.mjs
    exec node server.js
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
