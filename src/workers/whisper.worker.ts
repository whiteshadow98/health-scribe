// Offline speech-to-text with Whisper, running on the CPU (WebAssembly) so it doesn't
// compete with the language model for GPU memory.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

export const WHISPER_MODEL = 'onnx-community/whisper-base.en'

export type WhisperRequest = { type: 'load' } | { type: 'transcribe'; audio: Float32Array }
export type WhisperResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }

// Serve the ONNX Runtime WebAssembly file from this site, not the default public CDN.
env.allowLocalModels = false
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href }
  // GitHub Pages can't enable the headers needed for multi-threading.
  env.backends.onnx.wasm.numThreads = 1
}

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function post(message: WhisperResponse) {
  self.postMessage(message)
}

function load() {
  transcriber ??= pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (info: ProgressInfo) => {
      if (info.status === 'progress_total') post({ type: 'progress', loaded: info.loaded, total: info.total })
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  return transcriber
}

// Whisper sometimes outputs tags or filler for silence.
function clean(text: string) {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

self.onmessage = async (event: MessageEvent<WhisperRequest>) => {
  try {
    if (event.data.type === 'load') {
      await load()
      post({ type: 'ready' })
    } else {
      const asr = await load()
      const output = await asr(event.data.audio, { chunk_length_s: 30, stride_length_s: 5 })
      const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text
      post({ type: 'result', text: clean(text) })
    }
  } catch (err) {
    transcriber = null
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
