import { Header } from '@/components/layout/Header'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-navy-950">
      <Header />
      <main className="pb-safe">
        {children}
      </main>
    </div>
  )
}
