export type ZoneInfo = { key : string; name: string; color: string }

// Mapping zones selon le préfixe d'ID
export function getZoneByIdPrefix(questId: string | undefined | null): ZoneInfo {
  const id = (questId ?? '').trim()
  if (id.startsWith('Quest_18009') || id.startsWith('Quest_18008') || id.startsWith('Quest_1801') || id.startsWith('Quest_20') || id.startsWith('Quest_28') || id.startsWith('Quest_42') || id.startsWith('Quest_61') || id.startsWith('Quest_1802') || id.startsWith('Quest_1803'))  return { key: 'dunwood',      name: "NightHaven",       color: "#00ff22ff" }
  if (id.startsWith('06'))                                                                            return { key: 'windsward',        name: "Windsward",          color: "#00ffff" }       // cyan
  if (id.startsWith('12'))                                                                            return { key: 'monarchsbluffs',   name: "Monarch's Bluffs",   color: "#9ca3af" }       // gris
  if (id.startsWith('99_') || id.startsWith('99A_') || id.startsWith('04A_') || id.startsWith('EF_')) return { key: 'everfall',         name: "Everfall",           color: "#1f3a93" }       // bleu foncé
  if (id.startsWith('99B') || id.startsWith('02A_'))                                                  return { key: 'brightwood',       name: "Brightwood",         color: "#60a5fa" }       // bleu clair
  if (id.startsWith('99C') || id.startsWith('WF') || id.startsWith('13A_'))                           return { key: 'weaversfen',       name: "Weaver's Fen",       color: "#a78bfa" }       // mauve
  if (id.startsWith('99D') || id.startsWith('GC') || id.startsWith('03'))                             return { key: 'greatcleave',      name: "Great Cleave",       color: "#f59e0b" }       // orange clair
  if (id.startsWith('99E') || id.startsWith('14'))                                                    return { key: 'edengrove',        name: "Edengrove",          color: "#10b981" }       // vert
  if (id.startsWith('99F') || id.startsWith('08'))                                                    return { key: 'queensport',       name: "Ebonscale Reach",    color: "#b45309" }       // rouille
  if (id.startsWith('99G') || id.startsWith('07'))                                                    return { key: 'shatteredmountain',name: "Shattered Mountain", color: "#ef4444" }       // rouge
  if (id.startsWith('16') || id.startsWith('BS'))                                                     return { key: 'brimstonesands',   name: "Brimstone Sands",    color: "#facc15" }       // jaune sable
  if (id.startsWith('09A_'))                                                                          return { key: 'firstlight',       name: "Elysian Wilds",      color: "#86efac" }
  if (id.startsWith('15'))                                                                            return { key: 'restlessshore',    name: "Restless Shore",     color: "#ff23daff" }
  if (id.startsWith('11'))                                                                            return { key: 'mourningdale',     name: "Mourningdale",       color: "#3923ffff" }
  if (id.startsWith('05') || id.startsWith('Quest_02') || id.startsWith('Quest_1800'))                return { key: 'reekwater',        name: "Reekwater",          color: "#238aebff" }
  if (id.startsWith('C10A'))                                                                          return { key: 'cutlasskeys',      name: "Cutlass Keys",       color: "#fbff00ff" }

  // défaut
  return { key: 'unknown', name: "Unknown Zone", color: "#ffffff" }
}
