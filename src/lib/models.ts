// Which language model to run, based on what the device can handle.

export type ModelSize = '1.5B' | '0.5B'
export type ModelPreference = 'auto' | ModelSize

export type ModelOption = {
  size: ModelSize
  label: string
  downloadMb: number
}

export const MODEL_OPTIONS: Record<ModelSize, ModelOption> = {
  '1.5B': { size: '1.5B', label: 'Qwen2.5 1.5B', downloadMb: 880 },
  '0.5B': { size: '0.5B', label: 'Qwen2.5 0.5B', downloadMb: 290 },
}

export type DeviceSupport = {
  webgpu: boolean
  shaderF16: boolean
  memoryGb: number | null
  gpu: string
}

type GpuAdapter = {
  features: Set<string>
  info?: { vendor?: string; architecture?: string }
}
type NavigatorWithGpu = Navigator & {
  gpu?: { requestAdapter: (options?: { powerPreference?: string }) => Promise<GpuAdapter | null> }
  deviceMemory?: number
}

export async function detectDevice(): Promise<DeviceSupport> {
  const nav = navigator as NavigatorWithGpu
  const memoryGb = nav.deviceMemory ?? null
  const adapter = await nav.gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null)
  if (!adapter) return { webgpu: false, shaderF16: false, memoryGb, gpu: '' }
  return {
    webgpu: true,
    shaderF16: adapter.features.has('shader-f16'),
    memoryGb,
    gpu: [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' '),
  }
}

/** WebLLM model id. Devices without half-precision shaders need the f32 build. */
export function modelId(size: ModelSize, device: DeviceSupport): string {
  return `Qwen2.5-${size}-Instruct-${device.shaderF16 ? 'q4f16_1' : 'q4f32_1'}-MLC`
}

export function autoModelSize(device: DeviceSupport): ModelSize {
  // Chrome caps deviceMemory at 8, so 8 means "8 GB or more".
  return device.memoryGb !== null && device.memoryGb < 8 ? '0.5B' : '1.5B'
}

const PREFERENCE_KEY = 'health-scribe:model'
const FALLBACK_KEY = 'health-scribe:model-fallback'

export function getModelPreference(): ModelPreference {
  try {
    const value = localStorage.getItem(PREFERENCE_KEY)
    return value === '1.5B' || value === '0.5B' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function setModelPreference(preference: ModelPreference) {
  try {
    localStorage.setItem(PREFERENCE_KEY, preference)
    localStorage.removeItem(FALLBACK_KEY)
  } catch {
    // Storage unavailable: the choice just won't be remembered.
  }
}

/** Remembers that the larger model failed to load, so "auto" goes straight to the smaller one. */
export function markFallback() {
  try {
    localStorage.setItem(FALLBACK_KEY, '1')
  } catch {
    // Ignore.
  }
}

export function resolveModelSize(device: DeviceSupport): ModelSize {
  const preference = getModelPreference()
  if (preference !== 'auto') return preference
  try {
    if (localStorage.getItem(FALLBACK_KEY)) return '0.5B'
  } catch {
    // Ignore.
  }
  return autoModelSize(device)
}

export function modelLabel(size: ModelSize | null) {
  return size ? MODEL_OPTIONS[size].label : ''
}
