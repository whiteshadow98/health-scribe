import { Apple } from 'lucide-react'
import { localDay } from '../lib/db'
import {
  DAILY_TARGETS,
  NUTRIENTS,
  NUTRIENT_INFO,
  averageNutrition,
  dailyNutrition,
  formatAmount,
  getProfile,
  type Nutrient,
} from '../lib/nutrition'
import type { LogEntry } from '../lib/schema'

/** Average daily nutrition over the last 7 days against the daily targets. */
export function NutritionCard({ entries }: { entries: LogEntry[] }) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 6)
  const since = localDay(cutoff)
  const days = dailyNutrition(entries.filter((e) => e.day >= since))
  if (!days.length) return null

  const avg = averageNutrition(days)
  const target = DAILY_TARGETS[getProfile()]

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
          <Apple className="size-4 text-teal-700" aria-hidden />
          Nutrition per day
        </h2>
        <span className="text-xs text-slate-500">
          {days.length} {days.length === 1 ? 'day' : 'days'} with meals, last 7 days
        </span>
      </div>
      <div className="space-y-2.5">
        {NUTRIENTS.map((n) => (
          <Bar key={n} nutrient={n} value={avg[n]} target={target[n]} />
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Estimates from a standard food table and the amounts you logged. Targets follow ICMR-NIN guidance for adults; set yours in
        Settings.
      </p>
    </section>
  )
}

function Bar({ nutrient, value, target }: { nutrient: Nutrient; value: number; target: number }) {
  const pct = Math.round((value / target) * 100)
  const width = Math.min(100, pct)
  // Energy, carbs and fat are limits; the rest are minimums to reach.
  const isLimit = nutrient === 'kcal' || nutrient === 'carbs' || nutrient === 'fat'
  const tone = isLimit ? (pct > 110 ? 'bg-amber-500' : 'bg-teal-600') : pct < 60 ? 'bg-rose-500' : pct < 90 ? 'bg-amber-500' : 'bg-teal-600'
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-700">{NUTRIENT_INFO[nutrient].label}</span>
        <span className="tabular-nums text-slate-900">
          {formatAmount(nutrient, value)} <span className="text-xs text-slate-500">/ {formatAmount(nutrient, target)}</span>
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={`${NUTRIENT_INFO[nutrient].label} ${pct}% of target`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
