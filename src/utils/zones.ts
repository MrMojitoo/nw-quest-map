export type ZoneInfo = { name: string; color: string }

// Mapping zones selon le préfixe d'ID
export function getZoneByIdPrefix(questId: string | undefined | null): ZoneInfo {
  const id = (questId ?? '').trim()
  if (id.startsWith('06'))   return { name: "Windsward",          color: "#00ffff" }       // cyan
  if (id.startsWith('12'))   return { name: "Monarch's Bluffs",   color: "#9ca3af" }       // gris
  if (id.startsWith('99_') || id.startsWith('99A_')) return { name: "Everfall", color: "#1f3a93" } // bleu foncé
  if (id.startsWith('99B'))  return { name: "Brightwood",         color: "#60a5fa" }       // bleu clair
  if (id.startsWith('99C'))  return { name: "Brightwood",         color: "#a78bfa" }       // mauve
  if (id.startsWith('99D'))  return { name: "Great Cleave",       color: "#f59e0b" }       // orange clair
  if (id.startsWith('99E'))  return { name: "Edengrove",          color: "#10b981" }       // vert
  if (id.startsWith('99F'))  return { name: "Ebonscale Reach",    color: "#b45309" }       // rouille
  if (id.startsWith('99G'))  return { name: "Shattered Mountain", color: "#ef4444" }       // rouge
  if (id.startsWith('16'))   return { name: "Brimstone Sands",    color: "#facc15" }       // jaune sable
  if (id.startsWith('09A_')) return { name: "Elysian Wilds",      color: "#86efac" }       // vert clair
  // défaut
  return { name: "Zone inconnue", color: "#94a3b8" }
}
