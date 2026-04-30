import Link from 'next/link'
import { Bell, Settings, Zap } from 'lucide-react'

export function Header() {
  return (
    <header className="sticky top-0 pt-safe z-40 bg-navy-950/85 backdrop-blur-xl border-b border-navy-800">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center shadow-lg shadow-gold-900/40 group-hover:shadow-gold-900/60 transition-shadow">
            <Zap className="w-4 h-4 text-navy-950" />
          </div>
          <div className="leading-none">
            <span className="text-white font-bold text-sm tracking-tight">MultiVenza</span>
            <span className="text-gold-500 font-bold text-sm"> LeadHunter</span>
          </div>
        </Link>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            aria-label="Notificaciones"
            className="relative w-9 h-9 rounded-xl bg-navy-800 border border-navy-700 flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-navy-600 transition-colors"
          >
            <Bell className="w-4 h-4" />
            {/* Red dot for unread notifications */}
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-gold-500 ring-1 ring-navy-800" />
          </button>

          <button
            aria-label="Configuración"
            className="w-9 h-9 rounded-xl bg-navy-800 border border-navy-700 flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-navy-600 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  )
}
