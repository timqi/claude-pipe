#!/usr/bin/env bash
set -euo pipefail

: "${CLAUDEPIPE_DISCORD_TOKEN:?Set CLAUDEPIPE_DISCORD_TOKEN before deploying}"
: "${SSH_AUTH_SOCK:?Set SSH_AUTH_SOCK before deploying}"

DEPLOY_DIR="$(pwd)"
NODE_BIN="$(which node)"

npm run build

sudo tee /etc/systemd/system/claude-pipe.service > /dev/null <<EOF
[Unit]
Description=Claude Pipe Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$DEPLOY_DIR
Environment=HOME=$HOME
Environment=PATH=$PATH
Environment=CLAUDEPIPE_DISCORD_TOKEN=$CLAUDEPIPE_DISCORD_TOKEN
Environment=SSH_AUTH_SOCK=$SSH_AUTH_SOCK
ExecStart=$NODE_BIN dist/index.js
LogNamespace=claude-pipe
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo chmod 600 /etc/systemd/system/claude-pipe.service
sudo systemctl daemon-reload
sudo systemctl restart claude-pipe
sudo systemctl status claude-pipe --no-pager
