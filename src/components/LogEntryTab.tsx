import { Braces, Check, Clock, Loader2, RotateCcw, Sparkles, Undo2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { deleteEntry, saveEntry } from '../lib/db'
import { useLlm } from '../lib/llm'
import { parseNote } from '../lib/parse'
import { isEmptyLog, type LogEntry, type ParsedLog } from '../lib/schema'
import { LogDetails } from './LogDetails'
import { ModelCard } from './ModelCard'
import { VoiceButton } from './VoiceButton'

type Phase = 'editing' | 'processing' | 'saved' | 'undone'

const EXAMPLE = 'Had a double espresso at 2pm, sharp stomach pain around 4pm after eating a sandwich, slept 6 hours last night.'

export function LogEntryTab() {
  const llm = useLlm()
  const [note, setNote] = useState('')
  const [when, setWhen] = useState<string | null>(null) // datetime-local value, or null for "now"
  const [phase, setPhase] = useState<Phase>('editing')
  const [stream, setStream] = useState('')
  const [saved, setSaved] = useState<{ id: number; entry: Omit<LogEntry, 'id' | 'day'> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)

  const ready = llm.status === 'ready'
  const processing = phase === 'processing'

  const appendText = useCallback((text: string) => {
    setNote((current) => (current.trim() ? `${current.trim()} ${text}` : text))
  }, [])

  async function processAndSave() {
    const text = note.trim()
    if (!text || !ready) return
    setError(null)
    setStream('')
    setPhase('processing')
    const timestamp = when ? new Date(when) : new Date()

    let parsed: ParsedLog
    try {
      parsed = await parseNote(llm.chat, text, timestamp, setStream)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while processing the note.')
      setPhase('editing')
      return
    }

    if (isEmptyLog(parsed)) {
      setError('No food, symptoms, activity or sleep were found in this note, so nothing was saved. Try adding a bit more detail.')
      setPhase('editing')
      return
    }

    const entry = {
      ...parsed,
      timestamp: timestamp.toISOString(),
      raw_note: text,
      model: llm.modelId ?? '',
      created_at: new Date().toISOString(),
    }
    const id = await saveEntry(entry)
    setSaved({ id, entry })
    setPhase('saved')
  }

  async function undo() {
    if (!saved) return
    await deleteEntry(saved.id)
    setPhase('undone')
  }

  function startNew(keepNote: boolean) {
    if (!keepNote) {
      setNote('')
      setWhen(null)
    }
    setSaved(null)
    setStream('')
    setShowJson(false)
    setPhase('editing')
  }

  if ((phase === 'saved' || phase === 'undone') && saved) {
    const { entry } = saved
    const json = JSON.stringify(
      {
        timestamp: entry.timestamp,
        raw_note: entry.raw_note,
        intake: entry.intake,
        activities: entry.activities,
        symptoms: entry.symptoms,
        sleep_hours: entry.sleep_hours,
        general_notes: entry.general_notes,
      },
      null,
      2,
    )
    return (
      <div className="space-y-4">
        {phase === 'saved' ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-900 ring-1 ring-emerald-200">
            <Check className="size-5 shrink-0" aria-hidden />
            Saved to your history on this device.
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm font-medium text-slate-700">
            <Undo2 className="size-5 shrink-0" aria-hidden />
            Entry removed. Your note is still here if you want to edit it.
          </div>
        )}

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">What was logged</h2>
            <button
              onClick={() => setShowJson((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
            >
              <Braces className="size-3.5" aria-hidden />
              {showJson ? 'Hide JSON' : 'Show JSON'}
            </button>
          </div>
          {showJson ? (
            <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{json}</pre>
          ) : (
            <LogDetails log={entry} />
          )}
          <p className="mt-4 border-t border-slate-100 pt-3 text-sm italic text-slate-500">“{entry.raw_note}”</p>
        </section>

        <div className="flex gap-2">
          {phase === 'saved' ? (
            <>
              <button
                onClick={() => startNew(false)}
                className="flex-1 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white active:bg-teal-800"
              >
                Log another
              </button>
              <button
                onClick={undo}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-3 font-semibold text-slate-700 ring-1 ring-slate-300"
              >
                <Undo2 className="size-4" aria-hidden />
                Undo
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startNew(true)}
                className="flex-1 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white active:bg-teal-800"
              >
                Edit note
              </button>
              <button onClick={() => startNew(false)} className="rounded-xl px-4 py-3 font-semibold text-slate-700 ring-1 ring-slate-300">
                Start over
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ModelCard purpose="process your notes" />

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label htmlFor="note" className="font-semibold text-slate-900">
          How are you doing?
        </label>
        <p className="mt-0.5 text-sm text-slate-500">Speak or type what you ate, how you feel, activity and sleep. Messy is fine.</p>

        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={processing}
          rows={5}
          placeholder={EXAMPLE}
          className="mt-3 w-full resize-y rounded-xl border-0 bg-slate-50 p-3 text-base text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-teal-600 focus:outline-none disabled:opacity-60"
        />

        <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <Clock className="size-4 shrink-0" aria-hidden />
          {when === null ? (
            <>
              <span>Logging for right now.</span>
              <button onClick={() => setWhen(toLocalInput(new Date()))} className="font-medium text-teal-700 underline-offset-2 hover:underline">
                Change
              </button>
            </>
          ) : (
            <>
              <input
                type="datetime-local"
                value={when}
                max={toLocalInput(new Date())}
                onChange={(e) => setWhen(e.target.value || null)}
                className="min-w-0 rounded-lg border-0 bg-slate-50 px-2 py-1 text-sm ring-1 ring-slate-200"
                aria-label="When this note applies"
              />
              <button onClick={() => setWhen(null)} className="font-medium text-teal-700">
                Now
              </button>
            </>
          )}
        </div>

        <div className="mt-5 flex justify-center">
          <VoiceButton onText={appendText} disabled={processing} />
        </div>

        {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={processAndSave}
            disabled={!ready || !note.trim() || processing}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white active:bg-teal-800 disabled:bg-slate-300"
          >
            {processing ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Sparkles className="size-5" aria-hidden />}
            {processing ? 'Processing' : 'Process & Save'}
          </button>
          {note && !processing && (
            <button
              onClick={() => setNote('')}
              className="rounded-xl px-3 py-3 text-slate-600 ring-1 ring-slate-300"
              aria-label="Clear note"
              title="Clear note"
            >
              <RotateCcw className="size-5" aria-hidden />
            </button>
          )}
        </div>
      </section>

      {processing && (
        <section className="rounded-2xl bg-slate-900 p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Braces className="size-3.5" aria-hidden />
            Live JSON from the on-device model
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-emerald-300">
            {prettyPartial(stream) || 'Reading your note'}
          </pre>
        </section>
      )}
    </div>
  )
}

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Adds light line breaks to streaming JSON so it is readable before it is complete. */
function prettyPartial(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text.replace(/,\s*"/g, ',\n"').replace(/\[\{/g, '[\n  {').replace(/\},\s*\{/g, '},\n  {')
  }
}
