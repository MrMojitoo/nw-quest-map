export type ZoneInfo = { name: string; color: string }

// Mapping zones selon le préfixe d'ID
export function getZoneByIdPrefix(questId: string | undefined | null): ZoneInfo {
  const id = (questId ?? '').trim()
  if (id.startsWith('06'))   return { name: "Windsward",          color: "#00ffff" }       // cyan
  if (id.startsWith('12'))   return { name: "Monarch's Bluffs",   color: "#9ca3af" }       // gris
  if (id.startsWith('99_') || id.startsWith('99A_') || id.startsWith('04A_') || id.startsWith('EF_')) return { name: "Everfall", color: "#1f3a93" } // bleu foncé
  if (id.startsWith('99B') || id.startsWith('02A_'))  return { name: "Brightwood",         color: "#60a5fa" }       // bleu clair
  if (id.startsWith('99C') || id.startsWith('WF') || id.startsWith('13A_'))  return { name: "Weaver's Fen",         color: "#a78bfa" }       // mauve
  if (id.startsWith('99D') || id.startsWith('GC') || id.startsWith('03'))  return { name: "Great Cleave",       color: "#f59e0b" }       // orange clair
  if (id.startsWith('99E') || id.startsWith('14'))  return { name: "Edengrove",          color: "#10b981" }       // vert
  if (id.startsWith('99F') || id.startsWith('08'))  return { name: "Ebonscale Reach",    color: "#b45309" }       // rouille
  if (id.startsWith('99G') || id.startsWith('07'))  return { name: "Shattered Mountain", color: "#ef4444" }       // rouge
  if (id.startsWith('16') || id.startsWith('BS'))   return { name: "Brimstone Sands",    color: "#facc15" }       // jaune sable
  if (id.startsWith('09A_')) return { name: "Elysian Wilds",      color: "#86efac" }     
  if (id.startsWith('15')) return { name: "Restless Shore",      color: "#ff23daff" }     
  if (id.startsWith('11')) return { name: "Mourningdale",      color: "#3923ffff" }      
  if (id.startsWith('05')) return { name: "Reekwater",      color: "#238aebff" }        
  if (id.startsWith('C10A')) return { name: "Cutlass Keys",      color: "#fbff00ff" }   
  // défaut
  return { name: "Zone inconnue", color: "#ffffff" }
}
