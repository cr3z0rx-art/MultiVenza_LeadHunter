import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | null | undefined): string {
  if (!value && value !== 0) return '—'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000)     return `$${(value / 1_000).toFixed(0)}K`
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Intl.DateTimeFormat('es-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(dateStr))
}

export function daysAgo(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

export function stateFlag(state: string): string {
  const map: Record<string, string> = { FL: '🌊', GA: '🍑', IL: '🏙️', TX: '🌵', AZ: '☀️' }
  return map[state] ?? '📍'
}
