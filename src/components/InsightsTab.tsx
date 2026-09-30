import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUp, CalendarCheck, Info, Loader2, MessageCircleHeart } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  QUERY_PLAN_JSON_SCHEMA,
  buildPlanMessages,
  buildSummaryMessages,
  formatDay,
  runQuery,
  sanitizePlan,
  type QueryPlan,
  type QueryResult,
  type StatCard,
} from '../lib/analytics'
import { db } from '../lib/db'
import { useLlm } from '../lib/llm'
import { ModelCard } from './ModelCard'
import { VoiceButton } from './VoiceButton'

const EXAMPLES = [
  'How often do I get stomach pain after coffee?',
  'How has my sleep been this week?',
  'How many headaches did I have this month?',
]

type Phase = 'idle' | 'planning' | 'summarizing' | 'done'

export function InsightsTab() {
  const llm = useLlm()
  const entries = useLiveQuery(() => db.entries.orderBy('timestamp').toArray(), [])
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'planning' || phase === 'summarizing'
  const ready = llm.status === 'ready'
  const hasEntries = (entries?.length ?? 0) > 0

  const ask = useCallback(
    async (q: string) => {
      const text = q.trim()
      if (!text || !entries || !ready) return
      setAsked(text)
      setError(null)
      setResult(null)
      setAnswer('')
      setPhase('planning')
      try {
        const planText = await llm.chat(buildPlanMessages(text), { jsonSchema: QUERY_PLAN_JSON_SCHEMA, maxTokens: 120 })
        let raw: unknown = {}
        try {
          raw = JSON.parse(planText)
        } catch {
          // Fall through to an overview.
        }
        const plan = sanitizePlan(raw, text)
        const res = runQuery(entries, plan)
        setResult(res)
        setPhase('summarizing')
        const summary = await llm.chat(buildSummaryMessages(text, res), { temperature: 0.3, maxTokens: 220, onToken: setAnswer })
        setAnswer(summary.trim())
        setPhase('done')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
        setPhase('idle')
      }
    },
    [entries, ready, llm],
  )

  const glance = entries?.length ? runQuery(entries, { kind: 'overview', trigger: '', subject: '', window_hours: 6, days: 7 }).cards : []

  return (
    <div className="space-y-4">
      {hasEntries && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Last 7 days</h2>
          <CardGrid cards={glance} />
        </section>
      )}

      <ModelCard purpose="ask questions about your logs" />

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">Ask about your health history</h2>
        <p className="mt-0.5 text-sm text-slate-500">Answers are calculated from your logs on this device.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(question)
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question"
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-base ring-1 ring-slate-200 focus:ring-2 focus:ring-teal-600 focus:outline-none"
          />
          <VoiceButton
            size="small"
            disabled={busy}
            onText={(t) => {
              setQuestion(t)
              if (ready && hasEntries) ask(t)
            }}
          />
          <button
            type="submit"
            disabled={!ready || !hasEntries || !question.trim() || busy}
            aria-label="Ask"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-slate-900 text-white disabled:bg-slate-300"
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </form>

        {!hasEntries && entries !== undefined && (
          <p className="mt-4 text-sm text-slate-500">Log a few entries first, then come back to spot patterns.</p>
        )}

        {hasEntries && phase === 'idle' && !result && (
          <div className="mt-5 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                disabled={!ready}
                onClick={() => {
                  setQuestion(ex)
                  ask(ex)
                }}
                className="rounded-full bg-teal-50 px-3 py-1.5 text-left text-sm text-teal-900 ring-1 ring-teal-200 disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
      </section>

      {phase === 'planning' && (
        <div className="flex items-center gap-2 px-1 text-sm text-slate-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Reading your question
        </div>
      )}

      {result && (
        <section className="space-y-3">
          <p className="px-1 text-sm font-medium text-slate-900">“{asked}”</p>
          <p className="flex gap-1.5 px-1 text-xs text-slate-500">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {describePlan(result.plan)}
          </p>

          <CardGrid cards={result.cards} />

          <div className="rounded-2xl bg-teal-50 p-4 ring-1 ring-teal-200">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-800">
              <MessageCircleHeart className="size-4" aria-hidden />
              Summary
            </p>
            {answer ? (
              <p className="text-[15px] leading-relaxed text-teal-950">{answer}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-teal-800">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Writing a summary
              </p>
            )}
            {phase === 'done' && (
              <p className="mt-3 text-xs text-teal-800/80">Based only on what you logged. This is not medical advice.</p>
            )}
          </div>

          {result.matchedDays.length > 0 && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <CalendarCheck className="size-4" aria-hidden />
                Matching days
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.matchedDays.slice(0, 12).map((d) => (
                  <span key={d} className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-700">
                    {formatDay(d)}
                  </span>
                ))}
                {result.matchedDays.length > 12 && (
                  <span className="px-1 py-1 text-sm text-slate-500">and {result.matchedDays.length - 12} more</span>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function CardGrid({ cards }: { cards: StatCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-medium text-slate-500">{c.label}</p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{c.value}</p>
          {c.detail && <p className="mt-0.5 text-xs text-slate-500">{c.detail}</p>}
        </div>
      ))}
    </div>
  )
}

function describePlan(plan: QueryPlan) {
  const period = plan.days ? `the last ${plan.days} days` : 'all your logs'
  switch (plan.kind) {
    case 'after':
      return `Looked for ${plan.subject} on days with ${plan.trigger}, and within ${plan.window_hours} hours after it, across ${period}.`
    case 'frequency':
      return `Counted ${plan.subject} across ${period}.`
    case 'sleep':
      return `Looked at your sleep${plan.subject ? ` and ${plan.subject}` : ''} across ${period}.`
    default:
      return `Summarized ${period}.`
  }
}
