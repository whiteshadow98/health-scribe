import { Loader2, Mic, Square } from 'lucide-react'
import { WHISPER_DOWNLOAD_MB, useVoiceInput } from '../lib/voice'

type Props = {
  onText: (text: string) => void
  size?: 'large' | 'small'
  disabled?: boolean
}

export function VoiceButton({ onText, size = 'large', disabled }: Props) {
  const { status, progress, error, seconds, toggle } = useVoiceInput(onText)
  const busy = status === 'loading' || status === 'transcribing'
  const recording = status === 'recording'

  const label = recording
    ? 'Stop recording'
    : busy
      ? status === 'loading'
        ? 'Loading voice model'
        : 'Transcribing'
      : 'Start voice input'

  const large = size === 'large'
  const base = large ? 'size-16' : 'size-11'
  const icon = large ? 'size-7' : 'size-5'
  const colors = recording
    ? 'bg-rose-600 text-white active:bg-rose-700'
    : 'bg-teal-700 text-white active:bg-teal-800 disabled:bg-slate-300'

  let hint = ''
  if (recording) hint = `Listening ${formatSeconds(seconds)}. Tap to stop.`
  else if (status === 'loading')
    hint = progress > 0 && progress < 1 ? `Downloading voice model ${Math.round(progress * 100)}%` : 'Loading voice model'
  else if (status === 'transcribing') hint = 'Transcribing on this device'
  else if (large) hint = `Tap to speak. First use downloads a ${WHISPER_DOWNLOAD_MB} MB voice model.`

  return (
    <div className={large ? 'flex flex-col items-center gap-2' : 'relative flex items-center'}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || busy}
        aria-label={label}
        className={`relative grid shrink-0 place-items-center rounded-full shadow-sm transition-colors ${base} ${colors}`}
      >
        {recording && <span className="absolute inset-0 animate-ping rounded-full bg-rose-500 opacity-30" aria-hidden />}
        {busy ? (
          <Loader2 className={`${icon} animate-spin`} aria-hidden />
        ) : recording ? (
          <Square className={icon} fill="currentColor" aria-hidden />
        ) : (
          <Mic className={icon} aria-hidden />
        )}
      </button>
      {large && hint && <p className="text-center text-xs text-slate-500">{hint}</p>}
      {large && error && <p className="text-center text-xs font-medium text-rose-700">{error}</p>}
      {!large && (error || hint) && (
        <p
          role="status"
          className={`absolute right-0 top-full z-10 mt-1 w-60 text-right text-xs ${error && !hint ? 'font-medium text-rose-700' : 'text-slate-500'}`}
        >
          {hint || error}
        </p>
      )}
    </div>
  )
}

function formatSeconds(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
