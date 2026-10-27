# Corrections apportées

## 1. Suivi des invitations
- `src/utils/inviteCache.ts` (nouveau) : snapshot des invitations (uses/maxUses) + détection de l'invitation réellement utilisée
  (hausse du nombre d'utilisations, ou invitation limitée supprimée après sa dernière utilisation).
- `guildMemberAdd.ts` réécrit ; `inviteCreate.ts` (upsert + cache) ; `guildCreate.ts` (nouveau) ; `ready.ts` charge le cache.
- `guildMemberRemove.ts` : `Partials.GuildMember` (index.ts) + fetch des membres au démarrage => plus de départs perdus après un redémarrage.
  Lecture des audit logs avec délai de 1,5 s et fenêtre de 10 s.
- `index.ts` : chargement des commandes/events attendu avant `login`, intents inutiles retirés (MessageContent, GuildMessages).

## 2. Tickets
- Staff (admins + rôles de modération) ajouté aux permissions du salon à la création ; le bot aussi.
- Fermeture : propriétaire ou staff. Réouverture et suppression : staff uniquement.
- `/ticket close|reopen` utilisables par le staff (plus réservés aux admins) ; `category|message` restent admin.
- 1 ticket ouvert max par membre (`MAX_OPEN_TICKETS_PER_USER` dans `utils/ticketUtils.ts`).
- Pseudo nettoyé pour le nom du salon, renommage fiable même avec des tirets, `deferReply` à la création.
- Logique close/reopen factorisée dans `utils/ticketActions.ts`.

## 3. Invitations bonus
- Nouveau modèle `InviteBonus (guildId, userId, amount)` ; colonne `Invite.bonus` supprimée.
- `/admininvites`, `/invites`, `/leaderboard` adaptés.

## Divers
- Un seul `PrismaClient` partagé (`src/utils/prisma.ts`).

## À faire après mise à jour
1. `npx prisma generate && npx prisma db push` (la colonne `bonus` est supprimée : les anciens bonus ne sont pas migrés).
2. `npm run deploy` (les permissions par défaut de `/ticket` ont changé).
3. Le bot doit avoir : Gérer le serveur (lire les invitations), Voir les logs du serveur, Gérer les salons et Gérer les rôles (tickets).
4. Activer l'intent privilégié « Server Members » dans le portail développeur (déjà requis avant).

# Ajout : liaison Roblox (type RoWifi)
- Nouveaux modèles Prisma : `RobloxLink`, `RobloxVerification`, `RobloxConfig`, `RobloxBind`.
- Commandes : `/verify`, `/update`, `/unverify`, `/whois`, `/bind`, `/robloxconfig`, `/updateall` (dossier `src/commands/roblox`).
- Moteur : `utils/roblox.ts` (API Roblox : timeout, gestion du 429, cache), `utils/robloxSync.ts` (rôles + pseudo), événements `robloxMemberAdd` et `robloxReady`.
- Le bot ne gère QUE les rôles configurés (vérifié, non vérifié, binds) ; si l'API Roblox est en panne, aucun rôle n'est retiré.
- Le serveur doit pouvoir joindre users/groups/thumbnails.roblox.com. Variable optionnelle `ROBLOX_SYNC_MINUTES`.
- Le rôle du bot doit être AU-DESSUS des rôles à attribuer, avec les permissions « Gérer les rôles » et « Gérer les pseudos ».
- `index.ts` : une erreur dans un événement ne fait plus planter le bot.

# Ajout : vérification par connexion Roblox (OAuth, comme RoWifi)
- `/verify` sans pseudo : bouton « Se connecter avec Roblox » -> connexion Discord (vérifie que c'est bien le bon compte) -> connexion Roblox (OAuth2 + PKCE) -> lien + rôles + pseudo, et mise à jour du message Discord d'origine.
- Sécurité : état OAuth aléatoire à usage unique, expiration 10 min, cookie HttpOnly qui lie la session au navigateur (anti-détournement), contrôle de l'identité Discord avant l'étape Roblox.
- `src/web/server.ts` (serveur HTTP natif, aucune nouvelle dépendance), `src/utils/robloxOAuth.ts`, modèle Prisma `RobloxOAuthSession`.
- Non configuré => `/verify <pseudo>` (code dans le profil) reste disponible. Application Roblox non validée = 10 utilisateurs maximum en OAuth.

# Ajout : panel de configuration (style RoWifi) + mise à jour sans reconfiguration
- Panel web (`public/`, `src/web/api.ts`, `src/web/dashboard.ts`) : connexion Discord, vérification des droits via le bot (Administrateur ou Gérer le serveur), protection CSRF (Origin + en-tête dédié), cookies HttpOnly.
- Roblox : rôles multiples, rôles persistants et bypass, salon de logs, binds rank/group/custom/asset avec modèle et priorité, listes de refus (utilisateur, groupe, condition), journal d'audit, embed de vérification, détection automatique par serveur.
- Bouton « Lier mon compte » : connexion Discord puis Roblox sans passer par /verify.
- `update.sh` / `install.sh` : mise à jour et installation sans toucher à `.env` ni à la base.
- Schéma : nouvelles colonnes et tables (ajouts uniquement, `prisma db push` sans perte de données).
