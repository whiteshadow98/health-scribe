import { useEffect, useState } from 'react'

type Status = 'checking' | 'yes' | 'no'

type DeviceReport = {
  webgpu: Status
  shaderF16: Status
  memoryGb: number | null
  gpu: string
}

// Minimal WebGPU surface used for the device check (full types are not in lib.dom).
type GpuAdapter = {
  features: Set<string>
  info?: { vendor?: string; architecture?: string }
}
type NavigatorWithGpu = Navigator & {
  gpu?: { requestAdapter: () => Promise<GpuAdapter | null> }
  deviceMemory?: number
}

async function checkDevice(): Promise<DeviceReport> {
  const nav = navigator as NavigatorWithGpu
  const memoryGb = nav.deviceMemory ?? null
  if (!nav.gpu) return { webgpu: 'no', shaderF16: 'no', memoryGb, gpu: 'Not available' }

  const adapter = await nav.gpu.requestAdapter().catch(() => null)
  if (!adapter) return { webgpu: 'no', shaderF16: 'no', memoryGb, gpu: 'No adapter found' }

  const gpu = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ') || 'Unknown'
  return {
    webgpu: 'yes',
    shaderF16: adapter.features.has('shader-f16') ? 'yes' : 'no',
    memoryGb,
    gpu,
  }
}

function Row({ label, status, detail }: { label: string; status: Status; detail?: string }) {
  const badge = {
    checking: 'bg-slate-100 text-slate-600',
    yes: 'bg-emerald-100 text-emerald-800',
    no: 'bg-rose-100 text-rose-800',
  }[status]
  const text = { checking: 'Checking', yes: 'Supported', no: 'Not supported' }[status]

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="font-medium text-slate-900">{label}</p>
        {detail && <p className="text-sm text-slate-500">{detail}</p>}
      </div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${badge}`}>{text}</span>
    </div>
  )
}

export default function App() {
  const [report, setReport] = useState<DeviceReport | null>(null)

  useEffect(() => {
    checkDevice().then(setReport)
  }, [])

  const recommendedModel =
    report?.webgpu !== 'yes'
      ? 'None (this device cannot run the local AI)'
      : report.memoryGb !== null && report.memoryGb < 8
        ? 'Qwen2.5 0.5B'
        : 'Qwen2.5 1.5B'

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-bold text-slate-900">Health Scribe</h1>
        <p className="mt-2 text-slate-600">Private, on-device health logging by voice.</p>

        <div className="mt-4 inline-block rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white">
          100% client-side and private. Your notes never leave this device.
        </div>

        <section className="mt-8 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Device check</h2>
          <p className="mt-1 text-sm text-slate-500">Confirms this phone can run the local AI models.</p>

          <div className="mt-3 divide-y divide-slate-100">
            <Row label="WebGPU" status={report?.webgpu ?? 'checking'} detail={report?.gpu} />
            <Row
              label="Half-precision shaders"
              status={report?.shaderF16 ?? 'checking'}
              detail="Needed for the smaller, faster model build"
            />
            <div className="flex items-center justify-between gap-4 py-3">
              <p className="font-medium text-slate-900">Device memory</p>
              <span className="text-sm text-slate-600">
                {report ? (report.memoryGb !== null ? `${report.memoryGb} GB or more` : 'Unknown') : 'Checking'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <p className="font-medium text-slate-900">Recommended model</p>
              <span className="text-right text-sm text-slate-600">{report ? recommendedModel : 'Checking'}</span>
            </div>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-slate-400">Phase 0 preview. The full app is coming next.</p>
      </div>
    </main>
  )
}
