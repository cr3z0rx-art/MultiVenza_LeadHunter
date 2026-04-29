'use client'

import { useState, useCallback } from 'react'
import { useInView } from 'react-intersection-observer'
import { AnimatePresence } from 'framer-motion'
import { fetchLeads } from '@/app/actions'
import { LeadCard } from './LeadCard'
import type { Lead, LeadFilters } from '@/lib/types/lead'

interface LeadFeedProps {
  initialLeads: Lead[]
  totalCount:   number
  filters:      LeadFilters
  pageSize:     number
}

export function LeadFeed({ initialLeads, totalCount, filters, pageSize }: LeadFeedProps) {
  const [leads,     setLeads]     = useState<Lead[]>(initialLeads)
  const [page,      setPage]      = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore,   setHasMore]   = useState(initialLeads.length < totalCount)

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return
    setIsLoading(true)

    const from = page * pageSize
    const to   = from + pageSize - 1

    const { leads: newLeads } = await fetchLeads(filters, from, to)

    if (!newLeads.length) {
      setHasMore(false)
    } else {
      setLeads(prev => [...prev, ...newLeads])
      setPage(prev => prev + 1)
      setHasMore(from + newLeads.length < totalCount)
    }
    setIsLoading(false)
  }, [isLoading, hasMore, page, pageSize, filters, totalCount])

  const { ref } = useInView({
    threshold: 0.1,
    onChange: (inView) => { if (inView) loadMore() },
  })

  function handleUnlock(leadId: string) {
    setLeads(prev =>
      prev.map(l => l.id === leadId ? { ...l, is_unlocked: true } : l)
    )
  }

  if (!leads.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-navy-800 border border-navy-700 flex items-center justify-center mb-4 text-2xl">
          🔍
        </div>
        <p className="text-slate-400 font-semibold">Sin resultados</p>
        <p className="text-slate-600 text-sm mt-1">Ajusta los filtros para ver más leads</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {leads.map(lead => (
          <LeadCard key={lead.id} lead={lead} onUnlock={handleUnlock} />
        ))}
      </AnimatePresence>

      <div ref={ref} className="flex justify-center py-6">
        {isLoading && (
          <div className="flex items-center gap-2.5 text-slate-600 text-sm">
            <span className="w-4 h-4 border-2 border-navy-600 border-t-gold-500 rounded-full animate-spin" />
            Cargando más leads...
          </div>
        )}
        {!hasMore && leads.length > 0 && (
          <p className="text-slate-700 text-xs">
            {leads.length.toLocaleString()} de {totalCount.toLocaleString()} leads
          </p>
        )}
      </div>
    </div>
  )
}
