'use client'

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
  diamond: {
    label:     'DIAMANTE',
    badge:     'bg-gold-500/15 text-gold-400 border border-gold-500/40',
    accent:    'from-gold-700 via-gold-500 to-gold-700',
    score:     'bg-gold-500/15 border-gold-500/30 text-gold-400',
    unlockBtn: 'bg-gradient-to-r from-gold-600 to-gold-500 hover:from-gold-500 hover:to-gold-400 text-navy-950 shadow-gold-900/40',
    lockIcon:  'bg-gold-500/15 border-gold-500/30 text-gold-400',
    glow:      true,
  },
  premium: {
    label:     'PREMIUM',
    badge:     'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    accent:    'from-blue-800 via-blue-600 to-blue-800',
    score:     'bg-blue-500/15 border-blue-500/30 text-blue-400',
    unlockBtn: 'bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white',
    lockIcon:  'bg-navy-800 border-navy-600 text-slate-400',
    glow:      false,
  },
  standard: {
    label:     'STANDARD',
    badge:     'bg-slate-700/40 text-slate-400 border border-slate-700/60',
    accent:    'from-navy-800 via-navy-700 to-navy-800',
    score:     'bg-navy-900 border-navy-700 text-slate-300',
    unlockBtn: 'bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white',
    lockIcon:  'bg-navy-800 border-navy-600 text-slate-400',
    glow:      false,
  },
} as const

export function LeadCard({ lead, onUnlock }: LeadCardProps) {
  const t = TIER[lead.tier]
  const days = daysAgo(lead.permit_date)

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        'relative rounded-2xl border overflow-hidden bg-navy-800 border-navy-700',
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

      <div className="p-5">

        {/* ── HEADER ROW ────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">

            {/* Badge row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className={cn('text-[10px] font-black tracking-widest px-2.5 py-0.5 rounded-full', t.badge)}>
                {t.label}
              </span>
              {lead.no_gc && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  NO-GC
                </span>
              )}
              {lead.roof_classification === 'critical' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  TECHO 15+
                </span>
              )}
              {days !== null && days < 30 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" />
                  RECIENTE
                </span>
              )}
            </div>

            <h3 className="text-white font-semibold text-sm leading-snug truncate">
              {lead.project_type} · {stateFlag(lead.state)} {lead.city}
              {lead.county && <span className="text-slate-500 font-normal"> ({lead.county})</span>}
            </h3>
            {lead.zip_code && (
              <p className="text-slate-600 text-xs mt-0.5">{lead.zip_code}</p>
            )}
          </div>

          {/* Score pill */}
          <div className={cn(
            'flex-shrink-0 w-12 h-12 rounded-xl border flex flex-col items-center justify-center',
            t.score,
          )}>
            <span className="text-lg font-black leading-none tabular-nums">{lead.score}</span>
            <span className="text-[9px] uppercase tracking-widest opacity-70 mt-0.5">score</span>
          </div>
        </div>

        {/* ── FINANCIAL METRICS ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div className="bg-navy-900/70 rounded-xl p-3 border border-navy-700/60">
            <div className="flex items-center gap-1.5 mb-1">
              <Building2 className="w-3 h-3 text-slate-600" />
              <span className="text-slate-600 text-[10px] uppercase tracking-wider">Valor Proyecto</span>
            </div>
            <span className={cn(
              'text-base font-bold tabular-nums',
              lead.tier === 'diamond' ? 'text-gold-400' : 'text-white',
            )}>
              {formatCurrency(lead.estimated_valuation)}
            </span>
          </div>

          <div className="bg-navy-900/70 rounded-xl p-3 border border-navy-700/60">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3 h-3 text-emerald-600" />
              <span className="text-slate-600 text-[10px] uppercase tracking-wider">Utilidad 40%</span>
            </div>
            <span className="text-base font-bold text-emerald-400 tabular-nums">
              {formatCurrency(lead.projected_profit)}
            </span>
          </div>
        </div>

        {/* ── PERMIT METADATA ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-4 text-[11px] text-slate-600 flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
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
          <div className="flex gap-1.5 flex-wrap mb-4">
            {lead.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-navy-900 text-slate-600 border border-navy-700/50">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* ── PROTECTED FIELDS ──────────────────────────────────────────────── */}
        <div className={cn(
          'relative rounded-xl border p-4 mb-4 overflow-hidden',
          lead.is_unlocked
            ? 'bg-emerald-950/20 border-emerald-900/40'
            : 'bg-navy-900/50 border-navy-700/50',
        )}>
          {/* Lock overlay */}
          {!lead.is_unlocked && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
              <div className="flex flex-col items-center gap-2 px-4">
                <div className={cn('w-10 h-10 rounded-full border flex items-center justify-center', t.lockIcon)}>
                  <Lock className="w-4 h-4" />
                </div>
                <p className="text-[11px] text-slate-600 font-medium text-center">
                  Desbloquea para ver dirección, propietario y teléfono
                </p>
              </div>
            </div>
          )}

          {/* Field content — blurred when locked */}
          <div className={cn('space-y-2.5', !lead.is_unlocked && 'field-locked')}>
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
              <span className="text-slate-300 text-xs leading-relaxed">
                {lead.exact_address ?? '████ ████████ ██████, ████'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="text-slate-300 text-xs">
                {lead.owner_name ?? '███████ ████████'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="text-slate-300 text-xs font-mono tracking-wide">
                {lead.phone ?? '(███) ███-████'}
              </span>
            </div>
          </div>
        </div>

        {/* ── UNLOCK / UNLOCKED CTA ─────────────────────────────────────────── */}
        {lead.is_unlocked ? (
          <div className="flex items-center justify-center gap-2 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 text-xs font-semibold">
              Lead desbloqueado {lead.unlocked_at ? `· ${formatDate(lead.unlocked_at)}` : ''}
            </span>
          </div>
        ) : (
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.975 }}
            onClick={() => onUnlock(lead.id)}
            className={cn(
              'w-full py-3 px-4 rounded-xl font-bold text-sm tracking-wide',
              'flex items-center justify-center gap-2',
              'transition-all duration-200 shadow-lg',
              t.unlockBtn,
            )}
          >
            <Unlock className="w-4 h-4" />
            Desbloquear Lead
          </motion.button>
        )}
      </div>
    </motion.article>
  )
}
