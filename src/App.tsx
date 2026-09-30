import { History, Lightbulb, NotebookPen, Settings, ShieldCheck, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HistoryTab } from './components/HistoryTab'
import { InsightsTab } from './components/InsightsTab'
import { LogEntryTab } from './components/LogEntryTab'
import { SettingsSheet } from './components/SettingsSheet'
import { LlmProvider } from './lib/llm'

type Tab = 'log' | 'history' | 'insights'

const TABS: { id: Tab; label: string; icon: typeof History }[] = [
  { id: 'log', label: 'Log Entry', icon: NotebookPen },
  { id: 'history', label: 'History', icon: History },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
]

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export default function App() {
  const [tab, setTab] = useState<Tab>('log')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const online = useOnline()

  return (
    <LlmProvider>
      <div className="min-h-dvh bg-slate-50">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8" />
              <h1 className="text-lg font-bold text-slate-900">Health Scribe</h1>
            </div>
            <button onClick={() => setSettingsOpen(true)} className="rounded-full p-2 text-slate-600" aria-label="Open settings">
              <Settings className="size-5" aria-hidden />
            </button>
          </div>
          <div className="mx-auto mt-2 max-w-lg">
            {online ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-xs font-medium text-white">
                <ShieldCheck className="size-4 shrink-0" aria-hidden />
                100% client-side and private. Disconnect Wi-Fi to test offline mode.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white">
                <WifiOff className="size-4 shrink-0" aria-hidden />
                You are offline. Everything still works on this device.
              </p>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 pb-28 pt-4">
          <div hidden={tab !== 'log'}>
            <LogEntryTab />
          </div>
          <div hidden={tab !== 'history'}>
            <HistoryTab />
          </div>
          <div hidden={tab !== 'insights'}>
            <InsightsTab />
          </div>
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
          aria-label="Main"
        >
          <div className="mx-auto grid max-w-lg grid-cols-3">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id)
                  window.scrollTo({ top: 0 })
                }}
                aria-current={tab === id ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-semibold ${tab === id ? 'text-teal-700' : 'text-slate-500'}`}
              >
                <Icon className="size-6" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </nav>

        {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      </div>
    </LlmProvider>
  )
}
