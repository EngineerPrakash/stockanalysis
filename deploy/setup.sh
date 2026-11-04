#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu server (tested for Oracle Cloud "Always Free").
#
#   curl -fsSL https://raw.githubusercontent.com/EngineerPrakash/stockanalysis/main/deploy/setup.sh | bash
#
# Installs Docker, downloads the app, opens ports 80/443, starts the app with HTTPS
# and prints your web address and admin token. Safe to run again.
set -euo pipefail

REPO="${REPO:-https://github.com/EngineerPrakash/stockanalysis.git}"
DIR="${DIR:-$HOME/stockanalysis}"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

say "Installing Docker and git"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo apt-get update -qq && sudo apt-get install -y -qq git iptables-persistent >/dev/null 2>&1 || sudo apt-get install -y -qq git
sudo usermod -aG docker "$USER" || true

say "Opening ports 80 and 443 on this machine's firewall"
# Oracle's Ubuntu images block everything except SSH with iptables.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi
if command -v ufw >/dev/null && sudo ufw status | grep -q active; then sudo ufw allow 80,443/tcp; fi

say "Downloading the app"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
cd "$DIR/deploy"

if [ ! -f .env ]; then
  IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
  DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"   # free hostname that points at your IP; no domain purchase needed
  TOKEN="$(openssl rand -hex 16)"
  printf 'DOMAIN=%s\nADMIN_TOKEN=%s\n' "$DOMAIN" "$TOKEN" > .env
  chmod 600 .env
fi
mkdir -p data
[ -f data/config.yaml ] || cp ../config.yaml data/config.yaml

say "Building and starting (first time takes a few minutes)"
sudo docker compose up -d --build

# shellcheck disable=SC1091
. ./.env
cat <<MSG

  ✅ Your app is starting at:   https://$DOMAIN
     Admin token (to edit the watchlist):   $ADMIN_TOKEN

  The HTTPS certificate is issued on the first visit and may take a minute.
  Update later with:   bash $DIR/deploy/update.sh
  Logs:                cd $DIR/deploy && sudo docker compose logs -f app

MSG
