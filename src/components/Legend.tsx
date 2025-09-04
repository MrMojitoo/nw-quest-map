import React, { useMemo } from 'react'

type LegendProps = { quests: any[]; generatedAt?: string }

export default function Legend({ quests, generatedAt }: LegendProps) {
  // Tente de récupérer le timestamp depuis plusieurs formes possibles
  const iso = useMemo(() => {
    const qAny: any = quests as any
    return (
      generatedAt ||
      qAny?.generated_at ||
      qAny?.meta?.generated_at ||
      (Array.isArray(qAny) && qAny.length > 0 ? qAny[0]?.generated_at : null)
    )
  }, [quests, generatedAt])

  if (!iso) return null

  const dt = new Date(iso)
  const pretty = isNaN(dt.getTime()) ? String(iso) : dt.toLocaleString()

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        fontSize: 12,
        opacity: 0.8,
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        padding: '6px 10px',
        borderRadius: 6,
        pointerEvents: 'none',
      }}
    >
      Updated data on {pretty}
    </div>
  )
}