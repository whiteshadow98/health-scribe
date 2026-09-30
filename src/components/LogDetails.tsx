import { Activity, Moon, Pill, StickyNote, UtensilsCrossed, Coffee, X, Zap } from 'lucide-react'
import { entryNutrition, formatAmount } from '../lib/nutrition'
import type { Intake, ParsedLog, Severity } from '../lib/schema'

type ListKey = 'intake' | 'activities' | 'symptoms'

type Props = {
  log: ParsedLog
  /** When set, each item gets a remove button (used for correcting entries). */
  onRemove?: (list: ListKey, index: number) => void
}

const SEVERITY_STYLES: Record<Severity, string> = {
  mild: 'bg-amber-50 text-amber-900 ring-amber-200',
  moderate: 'bg-orange-50 text-orange-900 ring-orange-200',
  severe: 'bg-rose-50 text-rose-900 ring-rose-200',
}

/** Friendly view of a parsed log: symptoms, food and drink, activity, sleep and notes. */
export function LogDetails({ log, onRemove }: Props) {
  const empty = !log.intake.length && !log.activities.length && !log.symptoms.length && log.sleep_hours === null && !log.general_notes
  if (empty) return <p className="text-sm text-slate-500">Nothing health-related was found in this note.</p>

  return (
    <div className="space-y-3">
      {log.symptoms.length > 0 && (
        <Section icon={<Zap className="size-4" />} title="Symptoms">
          {log.symptoms.map((s, i) => (
            <Chip key={i} className={SEVERITY_STYLES[s.severity]} onRemove={onRemove && (() => onRemove('symptoms', i))}>
              <span className="font-medium">{s.type}</span>
              <span className="opacity-75">
                {' '}
                · {s.severity}
                {s.location && !s.type.includes(s.location) ? ` · ${s.location}` : ''}
                {s.time ? ` · ${formatTime(s.time)}` : ''}
              </span>
            </Chip>
          ))}
        </Section>
      )}

      {log.intake.length > 0 && (
        <Section icon={<UtensilsCrossed className="size-4" />} title="Food, drink and medicine">
          {log.intake.map((item, i) => {
            const Icon = item.category === 'beverage' ? Coffee : item.category === 'medication' ? Pill : UtensilsCrossed
            return (
              <Chip
                key={i}
                className="bg-sky-50 text-sky-900 ring-sky-200"
                onRemove={onRemove && (() => onRemove('intake', i))}
              >
                <Icon className="mr-1 inline size-3.5 align-[-2px]" aria-label={item.category} />
                <span className="font-medium">{describeIntake(item)}</span>
                {item.time && <span className="opacity-75"> · {formatTime(item.time)}</span>}
              </Chip>
            )
          })}
        </Section>
      )}

      {log.intake.length > 0 && <NutritionLine log={log} />}

      {log.activities.length > 0 && (
        <Section icon={<Activity className="size-4" />} title="Activity">
          {log.activities.map((a, i) => (
            <Chip key={i} className="bg-emerald-50 text-emerald-900 ring-emerald-200" onRemove={onRemove && (() => onRemove('activities', i))}>
              <span className="font-medium">{a.type}</span>
              <span className="opacity-75">
                {a.duration_mins ? ` · ${a.duration_mins} min` : ''}
                {a.time ? ` · ${formatTime(a.time)}` : ''}
              </span>
            </Chip>
          ))}
        </Section>
      )}

      {log.sleep_hours !== null && (
        <Section icon={<Moon className="size-4" />} title="Sleep">
          <Chip className="bg-indigo-50 text-indigo-900 ring-indigo-200">
            <span className="font-medium">{log.sleep_hours} hours</span>
          </Chip>
        </Section>
      )}

      {log.general_notes && (
        <Section icon={<StickyNote className="size-4" />} title="Notes">
          <p className="text-sm text-slate-700">{capitalize(log.general_notes)}</p>
        </Section>
      )}
    </div>
  )
}

function NutritionLine({ log }: { log: ParsedLog }) {
  const { total, items, unmatched } = entryNutrition(log)
  // Nothing worth showing for water, black tea and the like.
  if (!items.length || total.kcal < 5) return null
  return (
    <p className="-mt-1 text-xs text-slate-500">
      About {formatAmount('kcal', total.kcal)} · {formatAmount('protein', total.protein)} protein · {formatAmount('carbs', total.carbs)}{' '}
      carbs · {formatAmount('fat', total.fat)} fat
      {unmatched.length > 0 && <span> (not counted: {unmatched.join(', ')})</span>}
    </p>
  )
}

/** "2 roti", "1 bowl dal", "200 g paneer", or just the item when no amount was given. */
function describeIntake(item: Intake) {
  if (item.quantity === null) return item.item
  const q = item.quantity
  if (!item.unit || item.unit === 'serving') return item.unit === 'serving' && q !== 1 ? `${item.item} ×${q}` : `${q} ${item.item}`
  const unit = ['g', 'ml', 'l'].includes(item.unit) || q === 1 ? item.unit : `${item.unit}${item.unit.endsWith('s') ? 'es' : 's'}`
  return `${q} ${unit} ${item.item}`
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span aria-hidden>{icon}</span>
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ children, className, onRemove }: { children: React.ReactNode; className: string; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm ring-1 ${className}`}>
      <span>{children}</span>
      {onRemove && (
        <button onClick={onRemove} className="-mr-1 ml-1 rounded-full p-0.5 opacity-60 hover:opacity-100" aria-label="Remove">
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  )
}

export function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
