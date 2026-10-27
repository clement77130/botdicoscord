#!/usr/bin/env bash
# Première installation sur une VM (Debian/Ubuntu) : dépendances, base, compilation et service systemd.
# Il reste à remplir le fichier .env (jeton du bot, identifiants OAuth, URL publique) ; le reste se configure dans le panel.
set -euo pipefail
cd "$(dirname "$0")"

SERVICE="${BOT_SERVICE:-bot-army}"
DIR="$(pwd)"

command -v node >/dev/null || { echo "❌ Node.js 20+ est requis (https://deb.nodesource.com/setup_20.x)."; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 Fichier .env créé : ouvrez-le (nano .env), remplissez les valeurs, puis relancez bash install.sh"
  exit 0
fi

npm install --no-audit --no-fund
npx prisma generate
mkdir -p data backups
npx prisma db push
rm -rf dist
npm run build || true
[ -f dist/index.js ] || { echo "❌ La compilation a échoué."; exit 1; }
npm run deploy

if command -v systemctl >/dev/null && [ "$(id -u)" = "0" ]; then
  cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Bot Discord Armée de Terre RBLX
After=network-online.target
Wants=network-online.target

[Service]
User=root
WorkingDirectory=${DIR}
ExecStart=$(command -v node) dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"
  echo "✅ Service ${SERVICE} installé et démarré (journalctl -u ${SERVICE} -f pour les logs)."
else
  echo "ℹ️  Lancez le bot avec : npm start (ou relancez ce script en root pour créer le service)."
fi
