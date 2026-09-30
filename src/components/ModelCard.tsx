import { AlertTriangle, Cpu, Download, Loader2 } from 'lucide-react'
import { useLlm } from '../lib/llm'
import { MODEL_OPTIONS, modelLabel } from '../lib/models'

/** Shows the language model's status and the download button. Renders nothing once the model is ready. */
export function ModelCard({ purpose }: { purpose: string }) {
  const { status, size, progress, progressText, error, fellBack, load } = useLlm()

  if (status === 'ready') {
    if (!fellBack) return null
    return (
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        The larger model did not fit in this phone's memory, so the app switched to {modelLabel(size)}. It is faster but a little less
        accurate.
      </div>
    )
  }

  if (status === 'checking') {
    return (
      <Card>
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <span className="text-sm">Checking this device</span>
        </div>
      </Card>
    )
  }

  if (status === 'unsupported') {
    return (
      <Card tone="error">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-600" aria-hidden />
          <div className="text-sm text-rose-900">
            <p className="font-semibold">This browser can't run the on-device AI.</p>
            <p className="mt-1">It needs WebGPU. Use an up-to-date Chrome on Android 12 or newer. Your saved logs are still available.</p>
          </div>
        </div>
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <Card tone="error">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-600" aria-hidden />
          <div className="min-w-0 text-sm text-rose-900">
            <p className="font-semibold">The AI model could not load.</p>
            <p className="mt-1 break-words text-rose-800">{error}</p>
            <button onClick={load} className="mt-3 rounded-lg bg-rose-600 px-3 py-2 font-semibold text-white active:bg-rose-700">
              Try again
            </button>
          </div>
        </div>
      </Card>
    )
  }

  if (status === 'needs-download') {
    const mb = size ? MODEL_OPTIONS[size].downloadMb : 0
    return (
      <Card>
        <div className="flex gap-3">
          <Cpu className="mt-0.5 size-5 shrink-0 text-teal-700" aria-hidden />
          <div className="text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Download the on-device AI to {purpose}</p>
            <p className="mt-1">
              {modelLabel(size)} is about {mb} MB. It downloads once, then runs offline on this device. Wi-Fi is recommended.
            </p>
            <button
              onClick={load}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white active:bg-teal-800"
            >
              <Download className="size-4" aria-hidden />
              Download model
            </button>
          </div>
        </div>
      </Card>
    )
  }

  // Loading
  const percent = Math.round(progress * 100)
  return (
    <Card>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-900">{progressText || 'Loading model'}</span>
        <span className="tabular-nums text-slate-600">{percent}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-teal-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Keep this tab open. {modelLabel(size)} is stored on this device for next time.</p>
    </Card>
  )
}

function Card({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'error' }) {
  const styles = tone === 'error' ? 'bg-rose-50 ring-rose-200' : 'bg-white ring-slate-200'
  return <div className={`rounded-xl p-4 shadow-sm ring-1 ${styles}`}>{children}</div>
}
