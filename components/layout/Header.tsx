import Link from 'next/link'
import { Bell, Settings } from 'lucide-react'

export function Header() {
  return (
    <header className="sticky top-0 pt-safe z-40 border-b" style={{ background: 'rgba(8,13,20,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottomColor: 'rgba(0,212,232,0.10)' }}>
      <div className="max-w-full px-5 py-3 flex items-center justify-between">

        {/* Logo — same SVG + wordmark as multivenzadigital.com */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <svg width="34" height="34" viewBox="0 0 38 38" fill="none" className="flex-shrink-0">
            <polygon points="19,4 34,30 4,30" fill="#FF8200" opacity=".9" />
            <polygon points="19,12 29,28 9,28" fill="#00A3AD" />
          </svg>
          <div className="leading-none">
            <div className="font-extrabold text-base tracking-tight leading-none">
              <span style={{ color: '#00A3AD' }}>Multi</span><span style={{ color: '#FF8200' }}>Venza</span>
            </div>
            <div className="text-[10px] tracking-widest uppercase font-medium" style={{ color: '#8A9BAE', marginTop: '1px' }}>
              LeadHunter
            </div>
          </div>
        </Link>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            aria-label="Notificaciones"
            className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors border"
            style={{ background: 'rgba(13,20,32,0.7)', borderColor: 'rgba(0,212,232,0.12)' }}
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ring-1" style={{ background: '#00D4E8', ringColor: '#080D14' }} />
          </button>

          <button
            aria-label="Configuración"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors border"
            style={{ background: 'rgba(13,20,32,0.7)', borderColor: 'rgba(0,212,232,0.12)' }}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  )
}
