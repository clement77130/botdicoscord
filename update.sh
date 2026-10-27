#!/usr/bin/env bash
# Mise à jour du bot SANS toucher à la configuration :
#   - .env, data/ (base de données), backups/ et node_modules/ ne sont jamais écrasés
#   - la base est sauvegardée avant chaque mise à jour (10 sauvegardes conservées)
#   - toute la configuration du bot se fait dans le panel, rien à refaire sur la VM
#
# Utilisation :
#   bash update.sh                       mise à jour depuis GitHub (git pull)
#   bash update.sh armee-de-terre-rblx.zip   mise à jour depuis un zip envoyé sur la VM
#   SKIP_GIT=1 bash update.sh            les fichiers ont déjà été copiés à la main
set -euo pipefail
cd "$(dirname "$0")"

SERVICE="${BOT_SERVICE:-bot-army}"
ZIP="${1:-}"

echo "💾 Sauvegarde de la base de données…"
mkdir -p backups
if [ -f data/database.db ]; then
  cp data/database.db "backups/database-$(date +%Y%m%d-%H%M%S).db"
  ls -1t backups/database-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f --
fi

if [ -n "$ZIP" ]; then
  [ -f "$ZIP" ] || { echo "❌ Fichier introuvable : $ZIP"; exit 1; }
  command -v unzip >/dev/null || { echo "❌ « unzip » est requis : sudo apt install -y unzip"; exit 1; }
  echo "📦 Décompression de $ZIP…"
  TMP="$(mktemp -d)"
  unzip -q "$ZIP" -d "$TMP"
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [ -n "$SRC" ] || SRC="$TMP"
  (cd "$SRC" && tar --exclude=.env --exclude=data --exclude=backups --exclude=node_modules --exclude=dist -cf - .) | tar -xf -
  rm -rf "$TMP"
elif [ -d .git ] && [ -z "${SKIP_GIT:-}" ]; then
  echo "⬇️  Récupération du code (git pull)…"
  if ! git diff --quiet; then
    echo "   Des fichiers ont été modifiés à la main : mis de côté (git stash) avant la mise à jour."
    git stash push -m "avant-maj-$(date +%Y%m%d-%H%M%S)" >/dev/null
  fi
  git pull --ff-only
fi

echo "📚 Installation des dépendances…"
npm install --no-audit --no-fund

echo "🗄️  Mise à jour de la base de données (sans perte de données)…"
npx prisma generate
npx prisma db push

echo "🔨 Compilation…"
rm -rf dist
npm run build || echo "⚠️  tsc a signalé des erreurs de typage (le code a tout de même été compilé si dist/ existe)."
[ -f dist/index.js ] || { echo "❌ La compilation a échoué : dist/index.js est absent."; exit 1; }

echo "📡 Mise à jour des commandes slash…"
npm run deploy || echo "⚠️  Les commandes slash n'ont pas pu être mises à jour (réessayez : npm run deploy)."

if command -v systemctl >/dev/null && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"; then
  echo "🔄 Redémarrage du service ${SERVICE}…"
  systemctl restart "$SERVICE"
  sleep 3
  systemctl --no-pager --lines=8 status "$SERVICE" || true
else
  echo "ℹ️  Service « ${SERVICE} » introuvable : redémarrez le bot vous-même (npm start)."
fi

echo "✅ Mise à jour terminée."
