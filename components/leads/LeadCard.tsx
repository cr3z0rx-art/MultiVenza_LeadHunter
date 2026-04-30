'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Lock, Unlock, MapPin, User, Phone, Calendar,
  TrendingUp, Building2, AlertTriangle, Zap,
} from 'lucide-react'
import type { Lead } from '@/lib/types/lead'
import { formatCurrency, formatDate, daysAgo, stateFlag, cn } from '@/lib/utils'

interface LeadCardProps {
  lead: Lead
  onUnlock: (leadId: string) => void
}

const TIER = {
  diamante: {
    label:     'DIAMANTE',
    badge:     'bg-violet-500/15 text-violet-400 border border-violet-500/40',
    accent:    'from-violet-700 via-violet-500 to-violet-700',
    score:     'bg-violet-500/15 border-violet-500/30 text-violet-400',
    unlockBtn: 'bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white shadow-lg',
    lockIcon:  'bg-violet-500/15 border-violet-500/30 text-violet-400',
    glow:      true,
  },
  oro: {
    label:     'ORO',
    badge:     'bg-gold-500/15 text-gold-400 border border-gold-500/30',
    accent:    'from-gold-600 via-gold-500 to-gold-600',
    score:     'bg-gold-500/15 border-gold-500/30 text-gold-400',
    unlockBtn: 'bg-gradient-to-r from-gold-600 to-gold-500 hover:from-gold-500 hover:to-gold-400 text-navy-950',
    lockIcon:  'bg-navy-800 border-navy-600 text-slate-400',
    glow:      false,
  },
  plata: {
    label:     'PLATA',
    badge:     'bg-slate-700/40 text-slate-400 border border-slate-700/60',
    accent:    'from-navy-800 via-navy-700 to-navy-800',
    score:     'bg-navy-900 border-navy-700 text-slate-300',
    unlockBtn: 'bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white',
    lockIcon:  'bg-navy-800 border-navy-600 text-slate-400',
    glow:      false,
  },
} as const

export function LeadCard({ lead, onUnlock }: LeadCardProps) {
  // Safe lookup to prevent WSOD if database has legacy values (e.g., 'diamond')
  const t = TIER[lead.tier] || TIER.plata
  const days = daysAgo(lead.permit_date)
  const [isFetchingPhone, setIsFetchingPhone] = useState(false)

  const handleUnlockPhone = async () => {
    if (!confirm('¿Estás seguro de que deseas gastar un crédito premium para obtener el teléfono de este lead con BatchData?')) return
    
    setIsFetchingPhone(true)
    try {
      const res = await fetch('/api/leads/unlock-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      })
      
      if (res.ok) {
        window.location.reload()
      } else {
        const err = await res.json()
        alert(`Error: ${err.error || 'No se pudo obtener el teléfono'}`)
      }
    } catch (e) {
      alert('Error de conexión al intentar obtener el teléfono.')
    } finally {
      setIsFetchingPhone(false)
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        'relative rounded-xl border overflow-hidden bg-navy-800 border-navy-700/80',
        'transition-shadow duration-300',
        t.glow && 'animate-glow-gold border-gold-600/40',
      )}
    >
      {/* ── Gold shimmer overlay for Diamond ───────────────────────────────── */}
      {t.glow && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
        >
          <div className="absolute inset-0 shimmer-gold opacity-20" />
        </div>
      )}

      {/* ── Top accent gradient line ────────────────────────────────────────── */}
      <div className={cn('h-[2px] w-full bg-gradient-to-r', t.accent)} />

      <div className="p-4">

        {/* ── HEADER ROW ────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-2.5 mb-3">
          <div className="flex-1 min-w-0">

            {/* Badge row */}
            <div className="flex flex-wrap items-center gap-1 mb-1.5">
              <span className={cn('text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-md', t.badge)}>
                {t.label}
              </span>
              {lead.no_gc && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  NO-GC
                </span>
              )}
              {lead.roof_classification === 'critical' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-0.5">
                  <AlertTriangle className="w-2 h-2" />
                  TECHO 15+
                </span>
              )}
              {days !== null && days < 30 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/30 flex items-center gap-0.5">
                  <Zap className="w-2 h-2" />
                  RECIENTE
                </span>
              )}
            </div>

            <h3 className="text-white font-semibold text-[13px] leading-snug truncate">
              {lead.project_type} · {stateFlag(lead.state)} {lead.city}
              {lead.county && <span className="text-slate-500 font-normal"> ({lead.county})</span>}
            </h3>
            {lead.zip_code && (
              <p className="text-slate-600 text-[11px] mt-0.5">{lead.zip_code}</p>
            )}
          </div>

          {/* Score pill */}
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg border flex flex-col items-center justify-center',
            t.score,
          )}>
            <span className="text-sm font-black leading-none tabular-nums">{lead.score}</span>
            <span className="text-[8px] uppercase tracking-widest opacity-60 mt-0.5">score</span>
          </div>
        </div>

        {/* ── FINANCIAL METRICS ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-navy-900/60 rounded-lg p-2.5 border border-navy-700/50">
            <div className="flex items-center gap-1 mb-0.5">
              <Building2 className="w-2.5 h-2.5 text-slate-600" />
              <span className="text-slate-600 text-[9px] uppercase tracking-wider">Valor Proyecto</span>
            </div>
            <span className={cn(
              'text-sm font-bold tabular-nums',
              lead.tier === 'diamante' ? 'text-violet-400' : lead.tier === 'oro' ? 'text-gold-400' : 'text-white',
            )}>
              {formatCurrency(lead.estimated_valuation)}
            </span>
          </div>

          <div className="bg-navy-900/60 rounded-lg p-2.5 border border-navy-700/50">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingUp className="w-2.5 h-2.5 text-emerald-600" />
              <span className="text-slate-600 text-[9px] uppercase tracking-wider">Precio Lead</span>
            </div>
            <span className="text-sm font-bold text-emerald-400 tabular-nums">
              ${lead.projected_profit || (lead.tier === 'diamante' ? 500 : lead.tier === 'oro' ? 250 : 125)}
            </span>
          </div>
        </div>

        {/* ── PERMIT METADATA ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-3 text-[10px] text-slate-600 flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" />
            {formatDate(lead.permit_date)}
            {days !== null && <span className="text-slate-700">({days}d)</span>}
          </span>
          <span className="text-navy-600">·</span>
          <span className="font-mono text-slate-700">{lead.permit_number}</span>
          {lead.government_source && (
            <>
              <span className="text-navy-600">·</span>
              <span className="text-slate-700">{lead.government_source}</span>
            </>
          )}
        </div>

        {/* Tags row */}
        {lead.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-3">
            {lead.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-navy-900 text-slate-600 border border-navy-700/40">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* ── PROTECTED FIELDS ──────────────────────────────────────────────── */}
        <div className={cn(
          'relative rounded-lg border p-3 mb-3 overflow-hidden',
          lead.is_unlocked
            ? 'bg-emerald-950/20 border-emerald-900/40'
            : 'bg-navy-900/40 border-navy-700/40',
        )}>
          {/* Lock overlay */}
          {!lead.is_unlocked && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg">
              <div className="flex flex-col items-center gap-1.5 px-4">
                <div className={cn('w-8 h-8 rounded-full border flex items-center justify-center', t.lockIcon)}>
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <p className="text-[10px] text-slate-600 font-medium text-center">
                  Desbloquea para ver dirección, propietario y teléfono
                </p>
              </div>
            </div>
          )}

          {/* Field content — blurred when locked */}
          <div className={cn('space-y-2', !lead.is_unlocked && 'field-locked')}>
            <div className="flex items-start gap-1.5">
              <MapPin className="w-3 h-3 text-slate-500 mt-0.5 flex-shrink-0" />
              <span className="text-slate-300 text-[11px] leading-relaxed">
                {lead.exact_address ?? '████ ████████ ██████, ████'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <span className="text-slate-300 text-[11px]">
                {lead.owner_name ?? '███████ ████████'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Phone className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <span className="text-slate-300 text-[11px] font-mono tracking-wide">
                {lead.phone ?? '(███) ███-████'}
              </span>
            </div>
          </div>
        </div>

        {/* ── UNLOCK / UNLOCKED CTA ─────────────────────────────────────────── */}
        {lead.is_unlocked ? (
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex items-center justify-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-[11px] font-semibold">
                Lead desbloqueado {lead.unlocked_at ? `· ${formatDate(lead.unlocked_at)}` : ''}
              </span>
            </div>
            
            {!lead.phone && (
              <button
                onClick={handleUnlockPhone}
                disabled={isFetchingPhone}
                className={cn(
                  "w-full py-2.5 px-4 rounded-lg font-bold text-xs tracking-wide",
                  "flex items-center justify-center gap-1.5 transition-all duration-200 shadow-md",
                  "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <Phone className="w-3.5 h-3.5" />
                {isFetchingPhone ? 'Buscando...' : `Invertir 1 Crédito - Desbloquear Lead de $${lead.projected_profit || (lead.tier === 'diamante' ? 500 : lead.tier === 'oro' ? 250 : 125)}`}
              </button>
            )}
          </div>
        ) : (
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.975 }}
            onClick={() => onUnlock(lead.id)}
            className={cn(
              'w-full py-2.5 px-4 rounded-lg font-bold text-xs tracking-wide',
              'flex items-center justify-center gap-1.5',
              'transition-all duration-200 shadow-md',
              t.unlockBtn,
            )}
          >
            <Unlock className="w-3.5 h-3.5" />
            Desbloquear Lead
          </motion.button>
        )}
      </div>
    </motion.article>
  )
}
