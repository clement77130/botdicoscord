# Bot Discord Armée de Terre RBLX

Un bot Discord multifonctionnel avec système de tickets, giveaways, modération, système de bienvenue, suivi des invitations et liaison Roblox.

## Crédits

**Projet créé et développé par xdLulux (295515087731556362)**  
Tous droits réservés © 2025

## Tech Stack

- TypeScript
- Discord.js v14
- Prisma (SQLite)
- Node.js v20+

## Prérequis

- Node.js version 20 ou supérieure
- npm (inclus avec Node.js)
- Un bot Discord avec les permissions nécessaires

## Fonctionnalités

- **Système de Bienvenue**
  - Message de bienvenue personnalisé
  - Tracking des invitations
  - Statistiques des invitations

- **Système de Modération**
  - Ban/Unban
  - Kick
  - Mute temporaire
  - Logs de modération
  - Rôles de modération configurables

- **Système de Tickets**
  - Création via menu déroulant
  - Catégories personnalisables
  - Transcription des tickets
  - Système d'archivage

- **Système de Giveaway**
  - Création simple
  - Participation via bouton
  - Reroll des gagnants
  - Fin automatique

- **Liaison Roblox (type RoWifi)**
  - Vérification par code dans la description du profil Roblox
  - Rôles automatiques selon les rangs d'un groupe Roblox, rôle vérifié / non vérifié
  - Pseudo Discord synchronisé avec le pseudo Roblox (modèle configurable)
  - Mise à jour à l'arrivée, à la demande, en masse ou périodiquement

## Liste des Commandes

### Général
- `/about` - Affiche les informations sur le bot (Version, Uptime, Créateur, etc.)

### Configuration
- `/mod add <role>` - Ajouter un rôle de modération (Admin)
- `/mod remove <role>` - Retirer un rôle de modération (Admin)
- `/mod list` - Voir la liste des rôles de modération (Admin)
- `/setwelcome <channel>` - Définir le salon de bienvenue (Admin)
- `/logs output <channel>` - Définir le salon des logs (Admin)

### Modération
- `/ban <user> <reason> [duration]` - Bannir un utilisateur (Mod)
  > Exemple: `/ban @user Spam 7d`
- `/unban <user>` - Débannir un utilisateur (Mod)
  > Exemple: `/unban 123456789`
- `/kick <user> <reason>` - Expulser un utilisateur (Mod)
  > Exemple: `/kick @user Comportement inapproprié`
- `/mute <user> <duration> <reason>` - Muter temporairement un utilisateur (Mod)
  > Exemple: `/mute @user 1h Spam`

### Tickets
- `/ticket category <category>` - Définir la catégorie des tickets (Admin)
- `/ticket message <channel>` - Envoyer le message de création de ticket (Admin)
- `/ticket close` - Fermer un ticket (Mod)
- `/ticket reopen` - Réouvrir un ticket (Mod)

### Giveaways
- `/gstart <titre> <description> <winners> <duration>` - Créer un giveaway (Admin)
  > Exemple: `/gstart "Nitro" "Gagnez un mois de Nitro!" 1 24h`
- `/greroll <messageid>` - Relancer un giveaway terminé (Admin)
  > Exemple: `/greroll 123456789`

### Invitations
- `/invites [user]` - Voir ses statistiques d'invitations ou celles d'un utilisateur
  > Exemple: `/invites @user`
- `/leaderboard` - Voir le classement des invitations
- `/admininvites add <user> <amount>` - Ajouter des invitations bonus (Admin)
  > Exemple: `/admininvites add @user 5`
- `/admininvites remove <user> <amount>` - Retirer des invitations bonus (Admin)
  > Exemple: `/admininvites remove @user 2`

### Roblox
- `/verify` - Lier son compte Roblox en se connectant avec Discord puis Roblox (OAuth, comme RoWifi ; nécessite la configuration ci-dessous)
- `/verify <username>` - Lier son compte Roblox avec un code à coller dans « À propos de moi » (fonctionne sans configuration)
- `/update [user]` - Mettre à jour ses rôles et son pseudo (le staff peut cibler un membre)
- `/unverify [user]` - Délier son compte Roblox
- `/whois [user] [roblox]` - Voir le compte Roblox d'un membre, ou les membres liés à un pseudo Roblox
- `/bind group <group_id> <role> [rank] [min_rank] [max_rank]` - Associer des rangs d'un groupe à un rôle (Admin)
  > Rang `0` = non-membre du groupe ; sans rang = tous les membres du groupe
- `/bind list` / `/bind remove <id>` - Gérer les associations (Admin)
- `/robloxconfig nickname|verified-role|unverified-role|main-group|auto-update|view` - Configuration (Admin)
  > Variables du pseudo : `{roblox-username}` `{display-name}` `{discord-name}` `{roblox-id}` `{group-rank}` `{group-rank-number}`
- `/updateall` - Mettre à jour tous les membres du serveur (Admin)

### Embeds
- `/embedcreator simple <titre> <description> <couleur> <footer> [channel]` - Créer un embed simple (Mod)
  > Exemple: `/embedcreator simple "Titre" "Description" #FF0000 "Footer"`
- `/embedcreator json <json> [channel]` - Créer un embed avancé via Discohook (Mod)
  > Utilisez https://discohook.org pour créer votre embed

Note: (Admin) = Nécessite les permissions administrateur, (Mod) = Nécessite un rôle de modération

## Installation sur Ubuntu

1. Installer Node.js 20 et npm
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Vérifier l'installation
```bash
node --version # Doit afficher v20.x.x
npm --version
```

3. Récupérer le projet et se placer dans son dossier
```bash
unzip armee-de-terre-rblx.zip && cd armee-de-terre-rblx
```
4. Installer les dépendances
```bash
npm install
```
5. Configurer les variables d'environnement
```bash
cp .env.example .env
nano .env
```

6. Déployer les commandes slash
```bash
npm run deploy
```

7. Initialiser la base de données
```bash
npx prisma migrate dev
```

8. Compiler le TypeScript
```bash
npm run build
```

9. Lancer le bot
```bash
npm start
```


## Vérification par connexion Roblox (OAuth)
1. **Roblox** : https://create.roblox.com/dashboard/credentials → *OAuth 2.0 Apps* → *Create App*. Scopes `openid` et `profile`, URL de redirection `https://VOTRE_DOMAINE/callback/roblox`. Copier le Client ID et générer un Client Secret.
   > Tant que l'application n'est pas validée par Roblox (« review »), elle est limitée à 10 utilisateurs différents. Au-delà, `/verify <pseudo>` (méthode par code) reste utilisable sans limite.
2. **Discord** : portail développeur → OAuth2 → *Redirects* → ajouter `https://VOTRE_DOMAINE/callback/discord`, puis copier le *Client Secret*.
3. **`.env`** : renseigner `PUBLIC_URL`, `DISCORD_CLIENT_SECRET`, `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET` (et éventuellement `WEB_HOST` / `WEB_PORT`).
4. `npx prisma db push`, puis redémarrer le bot.
5. Exposer le port du bot en HTTPS (reverse proxy Caddy/Nginx ou tunnel Cloudflare) vers `http://127.0.0.1:3000`.


## Panel de configuration
Une fois `PUBLIC_URL` et les identifiants OAuth renseignés, le panel est disponible sur `PUBLIC_URL/dashboard`.
Connexion avec Discord ; il faut la permission « Gérer le serveur » sur un serveur où le bot est présent.

- **Aperçu** : mise à jour à l'arrivée, rôles vérifiés / non vérifiés / persistants / bypass, salon de logs, modèle de pseudo, groupe principal, détection automatique, embed de vérification (boutons « Lier mon compte » et « Mettre à jour mes rôles »), synchronisation de tous les membres.
- **Binds** : rankbinds (groupe + rang ou plage), groupbinds, custombinds (conditions), assetbinds (objet, badge, gamepass) avec modèle de pseudo, priorité et plusieurs rôles.
- **Listes de refus** : comptes, groupes ou conditions Roblox ; action « bloquer », « expulser » ou « bannir ».
- **Journal d'audit** : actions des membres et modifications faites depuis le panel.
- **Général**, **Tickets**, **Giveaways**, **Invitations** : réglages du reste du bot.

### Syntaxe des custombinds
`InGroup(groupe)`, `HasRank(groupe, rang)`, `RankAtLeast(groupe, rang)`, `RankAtMost(groupe, rang)`, `HasAsset(id)`, `HasBadge(id)`, `HasGamepass(id)`, combinables avec `and`, `or`, `not` et des parenthèses.
Exemple : `RankAtLeast(34870129, 10) and not InGroup(111)`

### Variables de pseudo
`{roblox-username}` `{display-name}` `{smart-name}` `{discord-name}` `{discord-id}` `{roblox-id}` `{group-rank}` `{group-rank-number}`

## Mise à jour du bot (sans refaire la configuration)
La configuration est dans la base de données (`data/`) et le `.env`, que les mises à jour ne touchent jamais.
```bash
bash update.sh                            # depuis GitHub
bash update.sh armee-de-terre-rblx.zip    # depuis un zip envoyé sur la VM
```
Le script sauvegarde la base (dossier `backups/`), met à jour le code, la base et les commandes slash, recompile et redémarre le service.
`bash install.sh` fait la première installation (dépendances, base, service systemd).
