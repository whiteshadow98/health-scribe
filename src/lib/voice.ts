import { useCallback, useEffect, useRef, useState } from 'react'
import type { WhisperRequest, WhisperResponse } from '../workers/whisper.worker'

export type VoiceStatus = 'idle' | 'loading' | 'recording' | 'transcribing' | 'error'

export const WHISPER_DOWNLOAD_MB = 105

// One Whisper worker shared by every mic button in the app.
let worker: Worker | null = null
const listeners = new Set<(message: WhisperResponse) => void>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WhisperResponse>) => listeners.forEach((l) => l(event.data))
  }
  return worker
}

function send(request: WhisperRequest, transfer: Transferable[] = []) {
  getWorker().postMessage(request, transfer)
}

/** Waits for the next response of one of the given types. */
function nextResponse<T extends WhisperResponse['type']>(
  types: T[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<Extract<WhisperResponse, { type: T }>> {
  return new Promise((resolve, reject) => {
    const listener = (message: WhisperResponse) => {
      if (message.type === 'progress') {
        onProgress?.(message.loaded, message.total)
      } else if (message.type === 'error') {
        listeners.delete(listener)
        reject(new Error(message.message))
      } else if ((types as string[]).includes(message.type)) {
        listeners.delete(listener)
        resolve(message as Extract<WhisperResponse, { type: T }>)
      }
    }
    listeners.add(listener)
  })
}

let modelReady: Promise<void> | null = null

function ensureModel(onProgress: (loaded: number, total: number) => void) {
  if (!modelReady) {
    const ready = nextResponse(['ready'], onProgress).then(() => undefined)
    send({ type: 'load' })
    modelReady = ready.catch((err) => {
      modelReady = null
      throw err
    })
  }
  return modelReady
}

/** Decodes recorded audio to 16 kHz mono samples, the format Whisper expects. */
async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16000 })
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    return buffer.getChannelData(0)
  } finally {
    context.close()
  }
}

/**
 * Tap to start recording, tap again to stop. The recording is transcribed on this device
 * and the text is passed to onText. Audio never leaves the phone.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const stopTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  useEffect(
    () => () => {
      stopTimer()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    },
    [],
  )

  const start = useCallback(async () => {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    } catch {
      setError('Microphone access was blocked. Allow it in Chrome site settings to use voice.')
      setStatus('error')
      return
    }

    // Start downloading or loading the voice model while the person talks.
    const modelLoading = ensureModel((loaded, total) => setProgress(total ? loaded / total : 0))

    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = async () => {
      stopTimer()
      stream.getTracks().forEach((t) => t.stop())
      try {
        const audio = await decodeAudio(new Blob(chunks, { type: recorder.mimeType }))
        if (audio.length < 16000 * 0.5) {
          setStatus('idle')
          return
        }
        setStatus('loading')
        await modelLoading
        setStatus('transcribing')
        const result = nextResponse(['result'])
        send({ type: 'transcribe', audio }, [audio.buffer])
        const { text } = await result
        if (text) onTextRef.current(text)
        else setError('No speech was detected. Try again a little closer to the mic.')
        setStatus('idle')
      } catch (err) {
        console.error('Transcription failed', err)
        setError('Voice transcription failed. Please try again or type your note.')
        setStatus('error')
      }
    }

    recorder.start()
    setSeconds(0)
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    setStatus('recording')
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') recorder.stop()
  }, [])

  const toggle = useCallback(() => {
    if (status === 'recording') stop()
    else if (status === 'idle' || status === 'error') start()
  }, [status, start, stop])

  return { status, progress, error, seconds, toggle }
}
