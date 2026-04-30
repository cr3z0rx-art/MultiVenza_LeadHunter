import Link from 'next/link'
import { Bell, Settings, TrendingUp } from 'lucide-react'

export function Header() {
  return (
    <header className="sticky top-0 pt-safe z-40 border-b" style={{ background: 'rgba(8,13,20,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottomColor: 'rgba(0,212,232,0.12)' }}>
      <div className="max-w-[1600px] mx-auto px-6 py-3.5 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group shrink-0">
          <svg width="32" height="32" viewBox="0 0 38 38" fill="none" className="flex-shrink-0">
            <polygon points="19,4 34,30 4,30" fill="#FF8200" opacity=".9" />
            <polygon points="19,12 29,28 9,28" fill="#00A3AD" />
          </svg>
          <div className="leading-none hidden sm:block">
            <div className="font-black text-lg tracking-tighter leading-none">
              <span style={{ color: '#00A3AD' }}>Multi</span><span style={{ color: '#FF8200' }}>Venza</span>
            </div>
            <div className="text-[9px] tracking-[0.2em] uppercase font-bold" style={{ color: '#526D82', marginTop: '2px' }}>
              LeadHunter
            </div>
          </div>
        </Link>

        {/* Navigation - Centered */}
        <nav className="hidden md:flex items-center bg-navy-800/40 rounded-full px-1.5 py-1 border border-navy-700/50">
          <Link href="/" className="text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full text-slate-400 hover:text-white transition-all hover:bg-navy-700/50">
            HotRadar
          </Link>
          <Link href="/insights" className="text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full text-slate-400 hover:text-white transition-all flex items-center gap-2 hover:bg-navy-700/50">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            Market Insights
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Mobile Insights Link */}
          <Link 
            href="/insights" 
            className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center text-emerald-400 hover:text-emerald-300 transition-colors border border-emerald-500/20 bg-emerald-500/5"
            aria-label="Market Insights"
          >
            <TrendingUp className="w-5 h-5" />
          </Link>

          <button
            aria-label="Notificaciones"
            className="relative w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors border bg-navy-900/50"
            style={{ borderColor: 'rgba(0,212,232,0.15)' }}
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-emerald-500 border-2 border-[#080D14]" />
          </button>

          <button
            aria-label="Configuración"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors border bg-navy-900/50"
            style={{ borderColor: 'rgba(0,212,232,0.15)' }}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

      </div>
    </header>
  )
}
