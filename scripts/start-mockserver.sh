#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
stop_occupied="${2:-}"
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ "$mode" != "dev" && "$mode" != "pm2" && "$mode" != "nohup" ]] || [[ -n "$stop_occupied" && "$stop_occupied" != "--stop-occupied" ]]; then
  echo "Uso: $0 {dev|pm2|nohup} [--stop-occupied]" >&2
  exit 64
fi

if [[ "$stop_occupied" == "--stop-occupied" ]]; then
  if command -v lsof >/dev/null 2>&1; then
    find_listener_pids() {
      lsof -n -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
    }
    stop_occupied_ports() {
      while IFS= read -r port; do
        while IFS= read -r process_id; do
          [[ -z "$process_id" ]] && continue
          echo "Deteniendo PID $process_id que ocupa el puerto $port..."
          kill "$process_id"
        done < <(find_listener_pids "$port" | tr ' ' '\n')
      done < <(node -e 'const fs = require("fs"); const path = process.env.SERVICE_CONFIG_PATH || "services.json"; JSON.parse(fs.readFileSync(path, "utf8")).forEach(service => console.log(service.port));')
    }
  elif command -v fuser >/dev/null 2>&1; then
    find_listener_pids() {
      fuser -n tcp "$1" 2>/dev/null || true
    }
    stop_occupied_ports() {
      while IFS= read -r port; do
        while IFS= read -r process_id; do
          [[ -z "$process_id" ]] && continue
          echo "Deteniendo PID $process_id que ocupa el puerto $port..."
          kill "$process_id"
        done < <(find_listener_pids "$port" | tr ' ' '\n')
      done < <(node -e 'const fs = require("fs"); const path = process.env.SERVICE_CONFIG_PATH || "services.json"; JSON.parse(fs.readFileSync(path, "utf8")).forEach(service => console.log(service.port));')
    }
  else
    stop_occupied_ports() {
      if command -v pm2 >/dev/null 2>&1 && pm2 describe mock-server >/dev/null 2>&1; then
        echo "Deteniendo instancia PM2 mock-server..."
        pm2 delete mock-server
      fi

      if [[ -f mockserver.pid ]]; then
        process_id="$(cat mockserver.pid)"
        if kill -0 "$process_id" 2>/dev/null; then
          echo "Deteniendo PID $process_id registrado en mockserver.pid..."
          kill "$process_id"
        fi
        rm -f mockserver.pid
      fi

      while IFS= read -r process_id; do
        [[ -z "$process_id" || "$process_id" == "$$" ]] && continue
        echo "Deteniendo PID $process_id de MockServer..."
        kill "$process_id"
      done < <(ps -ef | awk -v directory="$project_dir" '$0 ~ directory && $0 ~ /(node dist\/index\.js|tsx.*src\/index\.ts)/ { print $2 }')
    }
  fi

  stop_occupied_ports
fi

node scripts/check-listeners.js

case "$mode" in
  dev)
    exec npm run dev
    ;;
  pm2)
    command -v pm2 >/dev/null 2>&1 || {
      echo "PM2 no esta instalado. Ejecuta: npm install -g pm2" >&2
      exit 1
    }
    npm run build
    pm2 start npm --name mock-server -- start
    pm2 save
    ;;
  nohup)
    npm run build
    nohup npm start > mockserver.out 2>&1 &
    echo $! > mockserver.pid
    echo "MockServer iniciado con PID $(cat mockserver.pid). Log: $project_dir/mockserver.out"
    ;;
esac