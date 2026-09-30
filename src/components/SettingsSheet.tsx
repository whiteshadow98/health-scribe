import { useLiveQuery } from 'dexie-react-hooks'
import { Download, HardDrive, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { db, exportBackup, importBackup, localDay, requestPersistentStorage } from '../lib/db'
import { useLlm } from '../lib/llm'
import { MODEL_OPTIONS, getModelPreference, modelId, setModelPreference, type ModelPreference } from '../lib/models'

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const llm = useLlm()
  const count = useLiveQuery(() => db.entries.count(), [])
  const [usage, setUsage] = useState<{ used: number; persisted: boolean } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [preference, setPreference] = useState<ModelPreference>(getModelPreference)
  const fileRef = useRef<HTMLInputElement>(null)

  async function refreshUsage() {
    try {
      const [estimate, persisted] = await Promise.all([navigator.storage.estimate(), requestPersistentStorage()])
      setUsage({ used: estimate.usage ?? 0, persisted })
    } catch {
      setUsage(null)
    }
  }

  useEffect(() => {
    refreshUsage()
  }, [])

  async function download() {
    const blob = await exportBackup()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `health-scribe-backup-${localDay(new Date())}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage(`Backup saved with ${count ?? 0} entries. Keep the file somewhere safe.`)
  }

  async function restore(file: File) {
    try {
      const { added, skipped } = await importBackup(file)
      setMessage(`Imported ${added} ${added === 1 ? 'entry' : 'entries'}.${skipped ? ` ${skipped} already existed.` : ''}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  async function wipeLogs() {
    await db.entries.clear()
    setConfirmWipe(false)
    setMessage('All entries were deleted from this device.')
    refreshUsage()
  }

  async function removeModels() {
    if (!llm.device) return
    const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm')
    for (const size of ['1.5B', '0.5B'] as const) {
      await deleteModelAllInfoInCache(modelId(size, llm.device)).catch(() => undefined)
    }
    setMessage('Downloaded AI models were removed. Reload the app to download again.')
    refreshUsage()
  }

  function chooseModel(value: ModelPreference) {
    setPreference(value)
    setModelPreference(value)
    llm.switchModel()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-bold text-slate-900">
            Settings
          </h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500" aria-label="Close settings">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {message && <p className="mb-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-900 ring-1 ring-teal-200">{message}</p>}

        <Group title="Your data">
          <p className="text-sm text-slate-600">
            {count ?? 0} {count === 1 ? 'entry' : 'entries'} stored only on this device. If you clear Chrome's data or lose this phone, they
            are gone, so export a backup now and then.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={download} icon={<Download className="size-4" />}>
              Export backup
            </Button>
            <Button onClick={() => fileRef.current?.click()} icon={<Upload className="size-4" />}>
              Import backup
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) restore(file)
              e.target.value = ''
            }}
          />
        </Group>

        <Group title="AI model">
          <div className="space-y-2">
            {(
              [
                ['auto', 'Automatic', 'Picks the best model for this phone'],
                ['1.5B', MODEL_OPTIONS['1.5B'].label, `More accurate. ${MODEL_OPTIONS['1.5B'].downloadMb} MB download.`],
                ['0.5B', MODEL_OPTIONS['0.5B'].label, `Faster, lighter. ${MODEL_OPTIONS['0.5B'].downloadMb} MB download.`],
              ] as const
            ).map(([value, label, detail]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ${
                  preference === value ? 'bg-teal-50 ring-teal-300' : 'ring-slate-200'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={value}
                  checked={preference === value}
                  onChange={() => chooseModel(value)}
                  className="mt-1 accent-teal-700"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{detail}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            In use: {llm.status === 'ready' ? (llm.modelId ?? 'none') : 'not loaded'}
          </p>
        </Group>

        <Group title="Storage">
          <div className="flex items-start gap-3 text-sm text-slate-600">
            <HardDrive className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p>Using {usage ? formatBytes(usage.used) : 'unknown'} on this device, mostly the AI models.</p>
              <p className="mt-1">
                {usage?.persisted
                  ? 'Protected: Chrome will not clear this data when space runs low.'
                  : 'Not protected yet. Chrome usually grants this after you install the app to your home screen.'}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <Button onClick={removeModels} icon={<Trash2 className="size-4" />}>
              Remove downloaded models
            </Button>
          </div>
        </Group>

        <Group title="Privacy">
          <div className="flex gap-3 text-sm text-slate-600">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden />
            <p>
              Your notes, voice recordings and health data never leave this device. There is no server, no account and no analytics. The
              only network use is the one-time download of the AI models from Hugging Face and GitHub.
            </p>
          </div>
        </Group>

        <Group title="Danger zone">
          {confirmWipe ? (
            <div className="flex gap-2">
              <button onClick={wipeLogs} className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white">
                Yes, delete everything
              </button>
              <button onClick={() => setConfirmWipe(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 ring-slate-300">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmWipe(true)}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-700 ring-1 ring-rose-200"
            >
              Delete all entries
            </button>
          )}
        </Group>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 py-4 first-of-type:border-t-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function Button({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 active:bg-slate-50"
    >
      <span aria-hidden>{icon}</span>
      {children}
    </button>
  )
}

function formatBytes(bytes: number) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes > 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}
