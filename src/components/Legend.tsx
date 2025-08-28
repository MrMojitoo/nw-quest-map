import React, { useMemo } from 'react'

export default function Legend({ quests }: { quests: any[] }) {
  const zones = useMemo(() => {
    const set = new Set(quests.map(q => q.zone_id).filter((x:any)=>x!=null))
    return Array.from(set).sort((a:any,b:any)=>Number(a)-Number(b))
  }, [quests])

  return (
    <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
      <span className="muted">Légende :</span>
      {zones.map((z:any) => (
        <span key={String(z)} className="tag">Zone {String(z)}</span>
      ))}
      <span className="tag">Bordure verte = terminé</span>
    </div>
  )
}
