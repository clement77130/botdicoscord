import { Guild } from 'discord.js';

interface CachedInvite {
  uses: number;
  maxUses: number;
  inviterId: string | null;
}

export interface UsedInvite {
  code: string;
  inviterId: string | null;
}

// guildId -> (code -> état de l'invitation au dernier snapshot)
const cache = new Map<string, Map<string, CachedInvite>>();

export async function cacheGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    cache.set(
      guild.id,
      new Map(
        invites.map(i => [
          i.code,
          { uses: i.uses ?? 0, maxUses: i.maxUses ?? 0, inviterId: i.inviter?.id ?? null }
        ])
      )
    );
  } catch {
    // Permission "Gérer le serveur" manquante : on ne peut pas suivre les invitations
    console.warn(`⚠️ Impossible de lire les invitations de ${guild.name} (permission Gérer le serveur requise)`);
  }
}

export function addCachedInvite(guildId: string, code: string, inviterId: string | null, uses = 0, maxUses = 0): void {
  if (!cache.has(guildId)) cache.set(guildId, new Map());
  cache.get(guildId)!.set(code, { uses, maxUses, inviterId });
}

/**
 * Compare les invitations actuelles au dernier snapshot pour trouver celle qui vient d'être utilisée.
 * 1. une invitation dont le nombre d'utilisations a augmenté ;
 * 2. sinon une invitation limitée qui a disparu (dernière utilisation atteinte -> supprimée par Discord).
 */
export async function findUsedInvite(guild: Guild): Promise<UsedInvite | null> {
  const previous = cache.get(guild.id) ?? new Map<string, CachedInvite>();

  let fresh;
  try {
    fresh = await guild.invites.fetch();
  } catch {
    return null;
  }

  let used: UsedInvite | null = null;
  let usedPrevious = 0;
  let usedNow = 0;

  for (const invite of fresh.values()) {
    const before = previous.get(invite.code)?.uses ?? 0;
    const now = invite.uses ?? 0;
    if (now > before) {
      used = { code: invite.code, inviterId: invite.inviter?.id ?? null };
      usedPrevious = before;
      usedNow = now;
      break;
    }
  }

  if (!used) {
    for (const [code, entry] of previous) {
      if (!fresh.has(code) && entry.maxUses > 0 && entry.uses + 1 >= entry.maxUses) {
        used = { code, inviterId: entry.inviterId };
        break;
      }
    }
  }

  // Nouveau snapshot. Si deux membres arrivent presque en même temps, on n'avance le compteur que
  // d'une utilisation pour que la seconde arrivée soit encore détectée.
  const next = new Map<string, CachedInvite>();
  for (const invite of fresh.values()) {
    let uses = invite.uses ?? 0;
    if (used && invite.code === used.code && usedNow > usedPrevious + 1) {
      uses = usedPrevious + 1;
    }
    next.set(invite.code, {
      uses,
      maxUses: invite.maxUses ?? 0,
      inviterId: invite.inviter?.id ?? null
    });
  }
  cache.set(guild.id, next);

  return used;
}
