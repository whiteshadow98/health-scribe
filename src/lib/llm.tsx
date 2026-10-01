import type { ChatCompletionMessageParam, WebWorkerMLCEngine } from '@mlc-ai/web-llm'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  detectDevice,
  markFallback,
  modelId,
  resolveModelSize,
  type DeviceSupport,
  type ModelSize,
} from './models'
import { deleteRetiredModels, getAppConfig, isModelCached as isCached, webllm } from './webllm'

export type LlmStatus =
  | 'checking' // Detecting WebGPU and looking for a cached model
  | 'unsupported' // No WebGPU on this device
  | 'needs-download' // Model not cached yet; waits for the user to start the download
  | 'loading' // Downloading or loading from cache
  | 'ready'
  | 'error'

export type ChatOptions = {
  temperature?: number
  maxTokens?: number
  /** JSON schema string. When set, output is constrained to valid JSON of this shape. */
  jsonSchema?: string
  onToken?: (textSoFar: string) => void
}

type LlmContextValue = {
  status: LlmStatus
  device: DeviceSupport | null
  size: ModelSize | null
  modelId: string | null
  progress: number
  progressText: string
  cached: boolean
  error: string | null
  /** Set when the larger model failed and the app switched to the smaller one. */
  fellBack: boolean
  load: () => void
  switchModel: () => Promise<void>
  chat: (messages: ChatCompletionMessageParam[], options?: ChatOptions) => Promise<string>
}

const LlmContext = createContext<LlmContextValue | null>(null)



export function LlmProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LlmStatus>('checking')
  const [device, setDevice] = useState<DeviceSupport | null>(null)
  const [size, setSize] = useState<ModelSize | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [cached, setCached] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fellBack, setFellBack] = useState(false)

  const engineRef = useRef<WebWorkerMLCEngine | null>(null)
  const loadingRef = useRef(false)
  // Requests run one at a time; the engine cannot serve two generations at once.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const currentId = device && size ? modelId(size, device) : null

  const loadModel = useCallback(async (dev: DeviceSupport, preferred: ModelSize) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setError(null)

    // Try the preferred model; if the larger one fails (most likely out of GPU memory), fall back to the smaller one.
    const attempts: ModelSize[] = preferred === '1.5B' ? ['1.5B', '0.5B'] : [preferred]
    for (const target of attempts) {
      setStatus('loading')
      setProgress(0)
      setSize(target)
      const id = modelId(target, dev)
      const wasCached = await isCached(id)
      setProgressText(wasCached ? 'Loading model from this device' : 'Starting download')

      const onProgress = ({ progress, text }: { progress: number; text: string }) => {
        setProgress(progress)
        setProgressText(describeProgress(text, wasCached))
      }

      try {
        if (engineRef.current) {
          engineRef.current.setInitProgressCallback(onProgress)
          await engineRef.current.reload(id)
        } else {
          const [{ CreateWebWorkerMLCEngine }, appConfig] = await Promise.all([webllm(), getAppConfig()])
          const worker = new Worker(new URL('../workers/llm.worker.ts', import.meta.url), { type: 'module' })
          try {
            engineRef.current = await CreateWebWorkerMLCEngine(worker, id, { appConfig, initProgressCallback: onProgress })
          } catch (err) {
            worker.terminate()
            throw err
          }
        }
        setCached(true)
        setProgress(1)
        setStatus('ready')
        loadingRef.current = false
        void deleteRetiredModels()
        return
      } catch (err) {
        console.error(`Model load failed: ${id}`, err)
        if (target !== attempts.at(-1)) {
          markFallback()
          setFellBack(true)
          continue
        }
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    }
    loadingRef.current = false
  }, [])

  // On start: detect the device, then load right away if the model is already downloaded.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const dev = await detectDevice()
      if (cancelled) return
      setDevice(dev)
      if (!dev.webgpu) {
        setStatus('unsupported')
        return
      }
      const target = resolveModelSize(dev)
      setSize(target)
      const cached = await isCached(modelId(target, dev))
      if (cancelled) return
      setCached(cached)
      if (cached) loadModel(dev, target)
      else setStatus('needs-download')
    })()
    return () => {
      cancelled = true
    }
  }, [loadModel])

  const load = useCallback(() => {
    if (device && size) loadModel(device, size)
  }, [device, size, loadModel])

  // Applies a changed model preference. Loads right away only if that model is already
  // downloaded; otherwise waits for the user to tap Download.
  const switchModel = useCallback(async () => {
    if (!device || !device.webgpu || loadingRef.current) return
    const target = resolveModelSize(device)
    setFellBack(false)
    if (target === size && status === 'ready') return
    const cached = await isCached(modelId(target, device))
    setSize(target)
    setCached(cached)
    if (cached) {
      loadModel(device, target)
    } else {
      await engineRef.current?.unload().catch(() => undefined)
      setStatus('needs-download')
    }
  }, [device, size, status, loadModel])

  const chat = useCallback(async (messages: ChatCompletionMessageParam[], options: ChatOptions = {}) => {
    const run = async () => {
      const engine = engineRef.current
      if (!engine) throw new Error('The AI model is not loaded yet.')
      const stream = await engine.chat.completions.create({
        messages,
        stream: true,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 512,
        response_format: options.jsonSchema ? { type: 'json_object', schema: options.jsonSchema } : undefined,
      })
      let text = ''
      for await (const chunk of stream) {
        text += chunk.choices[0]?.delta?.content ?? ''
        options.onToken?.(text)
      }
      return text
    }
    const next = queueRef.current.then(run, run)
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  const value = useMemo<LlmContextValue>(
    () => ({
      status,
      device,
      size,
      modelId: currentId,
      progress,
      progressText,
      cached,
      error,
      fellBack,
      load,
      switchModel,
      chat,
    }),
    [status, device, size, currentId, progress, progressText, cached, error, fellBack, load, switchModel, chat],
  )

  return <LlmContext.Provider value={value}>{children}</LlmContext.Provider>
}

export function useLlm() {
  const ctx = useContext(LlmContext)
  if (!ctx) throw new Error('useLlm must be used inside LlmProvider')
  return ctx
}

/** Turns WebLLM's technical progress text into something friendlier. */
function describeProgress(text: string, fromCache: boolean): string {
  const mb = text.match(/(\d+)MB fetched/)
  if (mb) return fromCache ? 'Loading model from this device' : `Downloaded ${mb[1]} MB`
  if (/Loading model from cache/i.test(text)) return 'Loading model from this device'
  if (/shader|GPU|compil/i.test(text)) return 'Preparing the GPU'
  return fromCache ? 'Loading model from this device' : 'Downloading model'
}
