#!/usr/bin/env bash
# Installs user-level systemd units (no sudo):
#   mc-serve.service  keeps http://127.0.0.1:4317 running
#   mc-watch.timer    daily 08:30: git health scan + push radar items due within 3 days
# Remove with: systemctl --user disable --now mc-serve.service mc-watch.timer
set -euo pipefail
NODE="$HOME/.local/bin/node"
MC="$(cd "$(dirname "$0")/.." && pwd)/bin/mc.js"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/mc-serve.service" <<UNIT
[Unit]
Description=Mission Control local server
After=network-online.target

[Service]
ExecStart="$NODE" "$MC" serve
Restart=on-failure
Environment=PATH=$HOME/.local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT
cat > "$UNIT_DIR/mc-watch.service" <<UNIT
[Unit]
Description=Mission Control daily watch (scan + radar pushes)

[Service]
Type=oneshot
Environment=PATH=$HOME/.local/bin:/usr/bin:/bin
ExecStart=/bin/sh -c '"$NODE" "$MC" scan --quiet; "$NODE" "$MC" radar check --days 3'
UNIT
cat > "$UNIT_DIR/mc-watch.timer" <<UNIT
[Unit]
Description=Run Mission Control watch daily

[Timer]
OnCalendar=*-*-* 08:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now mc-serve.service mc-watch.timer
systemctl --user --no-pager status mc-serve.service | head -5
