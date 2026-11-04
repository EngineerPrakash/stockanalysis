#!/usr/bin/env bash
# Pull the latest code and restart. Your watchlist (deploy/data/config.yaml) and .env are kept.
set -euo pipefail
cd "$(dirname "$0")"
git -C .. pull --ff-only
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
echo "Updated. $(grep DOMAIN .env | sed 's/DOMAIN=/https:\/\//')"
