// Answers questions about the logs with plain JavaScript counting.
// The model only turns the question into a QueryPlan and phrases the final answer;
// every number shown comes from here, never from the model.

import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm'
import prompts from './prompts.json'
import {
  DAILY_TARGETS,
  NUTRIENTS,
  NUTRIENT_INFO,
  averageNutrition,
  dailyNutrition,
  formatAmount,
  getProfile,
  toNutrient,
  type Nutrient,
} from './nutrition'
import type { LogEntry, Severity } from './schema'

export type QueryKind = 'after' | 'frequency' | 'sleep' | 'overview' | 'nutrition'

export type QueryPlan = {
  kind: QueryKind
  /** The possible cause, for "after" questions (e.g. "coffee"). */
  trigger: string
  /** The thing being asked about (e.g. "stomach pain"). */
  subject: string
  window_hours: number
  /** Only look at the last N days. 0 means all time. */
  days: number
}

export const QUERY_PLAN_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['after', 'frequency', 'sleep', 'overview', 'nutrition'] },
    trigger: { type: 'string' },
    subject: { type: 'string' },
    window_hours: { type: 'integer' },
    days: { type: 'integer' },
  },
  required: ['kind', 'trigger', 'subject', 'window_hours', 'days'],
})

const PLAN_PROMPT = prompts.plan_system

const PLAN_EXAMPLES: [string, QueryPlan][] = [
  ['How often do I get headaches after drinking alcohol?', { kind: 'after', trigger: 'alcohol', subject: 'headache', window_hours: 12, days: 0 }],
  ['how many times did I have coffee this week', { kind: 'frequency', trigger: '', subject: 'coffee', window_hours: 6, days: 7 }],
  ['Does bad sleep make my back pain worse?', { kind: 'sleep', trigger: '', subject: 'back pain', window_hours: 6, days: 0 }],
]

export function buildPlanMessages(question: string, fewShot = true): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: PLAN_PROMPT }]
  for (const [q, plan] of fewShot ? PLAN_EXAMPLES : []) {
    messages.push({ role: 'user', content: q }, { role: 'assistant', content: JSON.stringify(plan) })
  }
  messages.push({ role: 'user', content: question.trim() })
  return messages
}

export function sanitizePlan(raw: unknown, question: string): QueryPlan {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kinds: QueryKind[] = ['after', 'frequency', 'sleep', 'overview', 'nutrition']
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
  const kind = kinds.includes(obj.kind as QueryKind) ? (obj.kind as QueryKind) : 'overview'
  const window = Number(obj.window_hours)
  const days = Number(obj.days)
  const plan: QueryPlan = {
    kind,
    trigger: str(obj.trigger),
    subject: str(obj.subject),
    window_hours: Number.isFinite(window) && window > 0 && window <= 48 ? Math.round(window) : 6,
    days: Number.isFinite(days) && days > 0 && days <= 3650 ? Math.round(days) : 0,
  }
  // Keep the plan consistent even if the model mixed things up.
  if (plan.kind === 'after' && (!plan.trigger || !plan.subject)) plan.kind = plan.subject || plan.trigger ? 'frequency' : 'overview'
  if (plan.kind === 'frequency' && !plan.subject) plan.subject = plan.trigger
  if (plan.kind === 'overview' && /sleep/i.test(question)) plan.kind = 'sleep'
  if (plan.kind === 'nutrition' && !plan.subject) plan.subject = 'all'
  return plan
}

// ---------------------------------------------------------------------------
// Term matching

// Words people use for the same thing. Asking about any word in a group matches all of them.
const SYNONYMS: string[][] = [
  ['stomach pain', 'stomach ache', 'stomachache', 'abdominal pain', 'tummy ache', 'belly pain', 'cramps', 'stomach cramps'],
  ['bloating', 'bloated', 'gas', 'gassy'],
  ['nausea', 'nauseous', 'queasy', 'sick to my stomach'],
  ['heartburn', 'acid reflux', 'reflux', 'indigestion', 'acidity'],
  ['headache', 'migraine', 'head pain', 'head ache'],
  ['fatigue', 'tired', 'tiredness', 'exhausted', 'exhaustion', 'low energy', 'sleepy', 'drowsy'],
  ['anxiety', 'anxious', 'stress', 'stressed', 'nervous', 'panic'],
  ['back pain', 'backache', 'lower back pain', 'back ache'],
]

// Broad terms and what they include. Asking about "coffee" includes a latte,
// but asking about "latte" only matches lattes.
const CATEGORIES: Record<string, string[]> = {
  coffee: ['espresso', 'latte', 'cappuccino', 'americano', 'macchiato', 'mocha', 'cold brew', 'flat white', 'cortado'],
  tea: ['chai', 'matcha', 'oolong'],
  caffeine: ['coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'mocha', 'cold brew', 'tea', 'chai', 'matcha', 'energy drink', 'red bull', 'cola', 'coke'],
  alcohol: ['beer', 'wine', 'whiskey', 'whisky', 'vodka', 'gin', 'rum', 'tequila', 'cocktail', 'margarita', 'sake', 'champagne', 'cider'],
  dairy: ['milk', 'cheese', 'yogurt', 'yoghurt', 'ice cream', 'butter', 'cream', 'paneer', 'curd', 'latte', 'cappuccino'],
  sugar: ['sweets', 'candy', 'chocolate', 'dessert', 'cake', 'cookie', 'donut', 'pastry', 'ice cream', 'soda'],
  sweets: ['candy', 'chocolate', 'dessert', 'cake', 'cookie', 'donut', 'pastry', 'ice cream'],
  gluten: ['bread', 'sandwich', 'pasta', 'pizza', 'wheat', 'bagel', 'toast', 'noodles', 'burger'],
  'spicy food': ['spicy', 'chili', 'chilli', 'curry', 'hot sauce', 'jalapeno'],
  'fried food': ['fries', 'fried', 'chips', 'fried chicken'],
  exercise: ['workout', 'gym', 'run', 'running', 'jog', 'jogging', 'walk', 'walking', 'yoga', 'swim', 'swimming', 'cycling', 'bike', 'hike', 'weights'],
  painkiller: ['ibuprofen', 'paracetamol', 'acetaminophen', 'aspirin', 'tylenol', 'advil', 'naproxen'],
}
CATEGORIES.spicy = CATEGORIES['spicy food']
CATEGORIES.workout = CATEGORIES.exercise
CATEGORIES.painkillers = CATEGORIES.painkiller

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'my', 'i', 'to', 'in', 'on', 'and', 'or', 'some', 'any', 'bad'])

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseRegex(phrase: string): RegExp {
  // Whole words only ("tea" must not match "steak"), with an optional plural ending.
  const words = phrase.trim().split(/\s+/).map(escapeRegex)
  return new RegExp(`\\b${words.join('\\s+')}(?:s|es)?\\b`, 'i')
}

function significantWords(term: string): string[] {
  return term
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

export type Matcher = { label: string; phrases: string[]; test: (text: string) => boolean }

export function makeMatcher(term: string): Matcher {
  const normalized = term.trim().toLowerCase()
  const phrases = new Set<string>([normalized])
  for (const group of SYNONYMS) {
    if (group.some((p) => p === normalized || phraseRegex(p).test(normalized))) group.forEach((p) => phrases.add(p))
  }
  CATEGORIES[normalized]?.forEach((p) => phrases.add(p))
  const regexes = [...phrases].filter(Boolean).map(phraseRegex)
  const words = significantWords(normalized)

  return {
    label: normalized,
    phrases: [...phrases],
    test: (text: string) => {
      if (!normalized) return false
      if (regexes.some((r) => r.test(text))) return true
      // "stomach pain" should also match a symptom "sharp pain" located in the "stomach".
      return words.length > 1 && words.every((w) => phraseRegex(w).test(text))
    },
  }
}

// ---------------------------------------------------------------------------
// Events

type EventKind = 'intake' | 'activity' | 'symptom'

type HealthEvent = {
  kind: EventKind
  text: string
  label: string
  day: string
  /** Exact time when the note gave one, otherwise null. */
  at: Date | null
  severity?: Severity
  entryId?: number
}

function eventTime(entry: LogEntry, time: string): Date | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  const [y, mo, d] = entry.day.split('-').map(Number)
  return new Date(y, mo - 1, d, h, m)
}

function toEvents(entries: LogEntry[]): HealthEvent[] {
  const events: HealthEvent[] = []
  for (const e of entries) {
    for (const i of e.intake) {
      events.push({ kind: 'intake', text: `${i.item} ${i.category}`, label: i.item, day: e.day, at: eventTime(e, i.time), entryId: e.id })
    }
    for (const a of e.activities) {
      events.push({ kind: 'activity', text: a.type, label: a.type, day: e.day, at: eventTime(e, a.time), entryId: e.id })
    }
    for (const s of e.symptoms) {
      events.push({
        kind: 'symptom',
        text: `${s.type} ${s.location}`,
        label: s.type,
        day: e.day,
        at: eventTime(e, s.time),
        severity: s.severity,
        entryId: e.id,
      })
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Results

export type StatCard = { label: string; value: string; detail?: string }

export type QueryResult = {
  plan: QueryPlan
  cards: StatCard[]
  /** Facts handed to the model for the written summary. */
  facts: string[]
  /** Days that matched, most recent first, for "show me the logs". */
  matchedDays: string[]
  /** True when there is too little data to say much. */
  limited: boolean
}

function pct(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0
}

function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`
}

function filterByDays(entries: LogEntry[], days: number): LogEntry[] {
  if (!days) return entries
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  return entries.filter((e) => new Date(e.timestamp) >= cutoff)
}

function periodText(days: number) {
  return days ? `in the last ${plural(days, 'day')}` : 'across all your logs'
}

function topCounts(labels: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>()
  for (const l of labels) {
    const key = l.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function average(values: number[]) {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null
}

export function runQuery(allEntriesList: LogEntry[], plan: QueryPlan): QueryResult {
  const entries = filterByDays(allEntriesList, plan.days)
  const days = [...new Set(entries.map((e) => e.day))]
  const events = toEvents(entries)
  const period = periodText(plan.days)

  switch (plan.kind) {
    case 'after':
      return afterQuery(plan, events, days, period)
    case 'frequency':
      return frequencyQuery(plan, events, days, period)
    case 'sleep':
      return sleepQuery(plan, entries, events, period)
    case 'nutrition':
      return nutritionQuery(plan, entries, events, period)
    default:
      return overviewQuery(plan, entries, events, days, period)
  }
}

function afterQuery(plan: QueryPlan, events: HealthEvent[], days: string[], period: string): QueryResult {
  const trigger = makeMatcher(plan.trigger)
  const subject = makeMatcher(plan.subject)
  const triggers = events.filter((e) => e.kind !== 'symptom' && trigger.test(e.text))
  const outcomes = events.filter((e) => e.kind === 'symptom' && subject.test(e.text))
  const windowMs = plan.window_hours * 60 * 60 * 1000

  // Timed: the symptom started within the window after the trigger.
  const timedTriggers = triggers.filter((t) => t.at)
  const followed = timedTriggers.filter((t) =>
    outcomes.some((o) => o.at && t.at && o.at > t.at && o.at.getTime() - t.at.getTime() <= windowMs),
  )

  // Day level: how often the symptom shows up on days with vs. without the trigger.
  const triggerDays = new Set(triggers.map((t) => t.day))
  const outcomeDays = new Set(outcomes.map((o) => o.day))
  const withTrigger = [...triggerDays]
  const withBoth = withTrigger.filter((d) => outcomeDays.has(d))
  const withoutTrigger = days.filter((d) => !triggerDays.has(d))
  const outcomeWithoutTrigger = withoutTrigger.filter((d) => outcomeDays.has(d))

  const cards: StatCard[] = [
    {
      label: `Days with ${plan.trigger}`,
      value: String(withTrigger.length),
      detail: `${plural(triggers.length, 'time')} logged ${period}`,
    },
    {
      label: `${capitalize(plan.subject)} on those days`,
      value: `${pct(withBoth.length, withTrigger.length)}%`,
      detail: `${withBoth.length} of ${plural(withTrigger.length, 'day')}`,
    },
    {
      label: `${capitalize(plan.subject)} on other days`,
      value: `${pct(outcomeWithoutTrigger.length, withoutTrigger.length)}%`,
      detail: `${outcomeWithoutTrigger.length} of ${plural(withoutTrigger.length, 'day')} without ${plan.trigger}`,
    },
  ]
  if (timedTriggers.length) {
    cards.push({
      label: `Within ${plural(plan.window_hours, 'hour')}`,
      value: `${followed.length} of ${timedTriggers.length}`,
      detail: `Times ${plan.trigger} was followed by ${plan.subject}`,
    })
  }

  const facts = [
    `Question type: does ${plan.trigger} come before ${plan.subject}? Looking ${period}.`,
    `Days logged in this period: ${days.length}.`,
    `${capitalize(plan.trigger)} was logged ${plural(triggers.length, 'time')} on ${plural(withTrigger.length, 'day')}. Matched items: ${listLabels(triggers)}.`,
    `${capitalize(plan.subject)} was logged ${plural(outcomes.length, 'time')} on ${plural(outcomeDays.size, 'day')}.`,
    `On days with ${plan.trigger}, ${plan.subject} happened on ${withBoth.length} of ${withTrigger.length} days (${pct(withBoth.length, withTrigger.length)}%).`,
    `On days without ${plan.trigger}, ${plan.subject} happened on ${outcomeWithoutTrigger.length} of ${withoutTrigger.length} days (${pct(outcomeWithoutTrigger.length, withoutTrigger.length)}%).`,
  ]
  if (timedTriggers.length) {
    facts.push(
      `Where times were recorded, ${plan.subject} started within ${plural(plan.window_hours, 'hour')} after ${plan.trigger} ${followed.length} of ${timedTriggers.length} times.`,
    )
  }

  return {
    plan,
    cards,
    facts,
    matchedDays: withBoth.sort().reverse(),
    limited: withTrigger.length < 3,
  }
}

function frequencyQuery(plan: QueryPlan, events: HealthEvent[], days: string[], period: string): QueryResult {
  const subject = makeMatcher(plan.subject)
  const matches = events.filter((e) => subject.test(e.text))
  const matchDays = [...new Set(matches.map((m) => m.day))]
  const perWeek = days.length ? Math.round((matches.length / days.length) * 7 * 10) / 10 : 0

  const cards: StatCard[] = [
    { label: 'Times logged', value: String(matches.length), detail: period },
    { label: 'Days with it', value: `${matchDays.length} of ${days.length}`, detail: `${pct(matchDays.length, days.length)}% of logged days` },
    { label: 'Per week', value: String(perWeek), detail: 'Based on days you logged' },
  ]
  const facts = [
    `Question type: how often ${plan.subject} happens. Looking ${period}.`,
    `Days logged in this period: ${days.length}.`,
    `${capitalize(plan.subject)} was logged ${plural(matches.length, 'time')} on ${plural(matchDays.length, 'day')} (${pct(matchDays.length, days.length)}% of logged days), about ${perWeek} times per week.`,
  ]
  if (matches.length) facts.push(`Matched items: ${listLabels(matches)}.`)

  const symptomMatches = matches.filter((m) => m.severity)
  if (symptomMatches.length) {
    const sev = { mild: 0, moderate: 0, severe: 0 }
    symptomMatches.forEach((m) => sev[m.severity!]++)
    cards.push({ label: 'Severity', value: `${sev.severe} severe`, detail: `${sev.moderate} moderate, ${sev.mild} mild` })
    facts.push(`Severity: ${sev.mild} mild, ${sev.moderate} moderate, ${sev.severe} severe.`)
  }

  const timed = matches.filter((m) => m.at)
  if (timed.length) {
    const parts = topCounts(timed.map((m) => partOfDay(m.at!)), 1)
    facts.push(`Most often in the ${parts[0][0]} (${parts[0][1]} of ${timed.length} timed entries).`)
  }
  if (matchDays.length) facts.push(`Most recent: ${formatDay(matchDays.sort().at(-1)!)}.`)

  return { plan, cards, facts, matchedDays: matchDays.sort().reverse(), limited: days.length < 3 }
}

function sleepQuery(plan: QueryPlan, entries: LogEntry[], events: HealthEvent[], period: string): QueryResult {
  // One sleep value per day (the latest entry that mentions sleep).
  const sleepByDay = new Map<string, number>()
  for (const e of entries) if (e.sleep_hours !== null) sleepByDay.set(e.day, e.sleep_hours)
  const values = [...sleepByDay.values()]
  const avg = average(values)
  const short = values.filter((v) => v < 6).length

  const cards: StatCard[] = [
    { label: 'Average sleep', value: avg !== null ? `${avg} h` : 'No data', detail: `${plural(values.length, 'night')} logged ${period}` },
    { label: 'Short nights', value: String(short), detail: 'Less than 6 hours' },
  ]
  const facts = [
    `Question type: sleep. Looking ${period}.`,
    `Nights with sleep logged: ${values.length}. Average ${avg ?? 'unknown'} hours. Shortest ${values.length ? Math.min(...values) : 'unknown'}, longest ${values.length ? Math.max(...values) : 'unknown'}.`,
    `Nights under 6 hours: ${short}.`,
  ]
  let matchedDays: string[] = []

  if (plan.subject) {
    const subject = makeMatcher(plan.subject)
    const symptomDays = new Set(events.filter((e) => e.kind === 'symptom' && subject.test(e.text)).map((e) => e.day))
    const withSymptom = [...sleepByDay].filter(([d]) => symptomDays.has(d)).map(([, v]) => v)
    const withoutSymptom = [...sleepByDay].filter(([d]) => !symptomDays.has(d)).map(([, v]) => v)
    const shortDays = [...sleepByDay].filter(([, v]) => v < 6).map(([d]) => d)
    const shortWithSymptom = shortDays.filter((d) => symptomDays.has(d))
    const avgWith = average(withSymptom)
    const avgWithout = average(withoutSymptom)

    cards.push({
      label: `Sleep on ${plan.subject} days`,
      value: avgWith !== null ? `${avgWith} h` : 'No data',
      detail: avgWithout !== null ? `${avgWithout} h on other days` : undefined,
    })
    cards.push({
      label: `${capitalize(plan.subject)} after short nights`,
      value: `${pct(shortWithSymptom.length, shortDays.length)}%`,
      detail: `${shortWithSymptom.length} of ${plural(shortDays.length, 'short night')}`,
    })
    facts.push(
      `Average sleep on days with ${plan.subject}: ${avgWith ?? 'unknown'} hours (${plural(withSymptom.length, 'day')}). On days without: ${avgWithout ?? 'unknown'} hours (${plural(withoutSymptom.length, 'day')}).`,
      `${capitalize(plan.subject)} was logged on ${shortWithSymptom.length} of ${shortDays.length} days after sleeping under 6 hours.`,
    )
    matchedDays = [...symptomDays].sort().reverse()
  }

  return { plan, cards, facts, matchedDays, limited: values.length < 3 }
}

function nutritionQuery(plan: QueryPlan, entries: LogEntry[], events: HealthEvent[], period: string): QueryResult {
  const days = dailyNutrition(entries)
  const target = DAILY_TARGETS[getProfile()]
  const facts = [
    `Question type: nutrition. Looking ${period}. Values are estimates from a standard food table, averaged over days with food logged.`,
    `Days with food logged: ${days.length}.`,
  ]
  if (!days.length) {
    return {
      plan,
      cards: [{ label: 'Food logged', value: 'None', detail: `No meals recognised ${period}` }],
      facts: [...facts, 'No meals were logged, so nutrition cannot be estimated.'],
      matchedDays: [],
      limited: true,
    }
  }

  const avg = averageNutrition(days)
  const pctOf = (n: Nutrient) => Math.round((avg[n] / target[n]) * 100)
  const nutrient = toNutrient(plan.subject)
  const shown: Nutrient[] = nutrient ? [nutrient] : ['kcal', 'protein', 'fibre', 'iron']

  const cards: StatCard[] = shown.map((n) => ({
    label: `${NUTRIENT_INFO[n].label} per day`,
    value: formatAmount(n, avg[n]),
    detail: `${pctOf(n)}% of the ${formatAmount(n, target[n])} target`,
  }))
  for (const n of nutrient ? [nutrient] : NUTRIENTS) {
    facts.push(`Average ${NUTRIENT_INFO[n].label.toLowerCase()}: ${formatAmount(n, avg[n])} per day, ${pctOf(n)}% of the daily target of ${formatAmount(n, target[n])}.`)
  }

  if (nutrient) {
    // Which foods contributed most to this nutrient.
    const sources = new Map<string, number>()
    for (const d of days) for (const i of d.items) sources.set(i.food, (sources.get(i.food) ?? 0) + i.nutrition[nutrient])
    const top = [...sources].sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (top.length) {
      cards.push({ label: 'Top sources', value: capitalize(top[0][0]), detail: top.slice(1).map(([f]) => f).join(', ') || undefined })
      facts.push(`Biggest sources: ${top.map(([f, v]) => `${f} (${formatAmount(nutrient, v)} total)`).join(', ')}.`)
    }
    const best = days.reduce((a, b) => (b.total[nutrient] > a.total[nutrient] ? b : a))
    const low = days.filter((d) => d.total[nutrient] < target[nutrient] * 0.6).length
    cards.push({ label: 'Low days', value: `${low} of ${days.length}`, detail: 'Under 60% of the target' })
    facts.push(`Highest day: ${formatDay(best.day)} with ${formatAmount(nutrient, best.total[nutrient])}. Days under 60% of target: ${low} of ${days.length}.`)

    if (plan.trigger) {
      const subject = makeMatcher(plan.trigger)
      const symptomDays = new Set(events.filter((e) => e.kind === 'symptom' && subject.test(e.text)).map((e) => e.day))
      const withS = days.filter((d) => symptomDays.has(d.day))
      const withoutS = days.filter((d) => !symptomDays.has(d.day))
      const a = averageNutrition(withS)[nutrient]
      const b = averageNutrition(withoutS)[nutrient]
      cards.push({
        label: `On ${plan.trigger} days`,
        value: withS.length ? formatAmount(nutrient, a) : 'No data',
        detail: withoutS.length ? `${formatAmount(nutrient, b)} on other days` : undefined,
      })
      facts.push(
        `On days with ${plan.trigger}: average ${formatAmount(nutrient, a)} (${plural(withS.length, 'day')}). On other days: ${formatAmount(nutrient, b)} (${plural(withoutS.length, 'day')}).`,
      )
      return { plan, cards, facts, matchedDays: [...symptomDays].sort().reverse(), limited: withS.length < 3 || withoutS.length < 3 }
    }
  }

  return { plan, cards, facts, matchedDays: days.map((d) => d.day).reverse(), limited: days.length < 3 }
}

function overviewQuery(plan: QueryPlan, entries: LogEntry[], events: HealthEvent[], days: string[], period: string): QueryResult {
  const symptoms = topCounts(events.filter((e) => e.kind === 'symptom').map((e) => e.label), 3)
  const intake = topCounts(events.filter((e) => e.kind === 'intake').map((e) => e.label), 3)
  const sleep = average(entries.map((e) => e.sleep_hours).filter((v): v is number => v !== null))

  const cards: StatCard[] = [
    { label: 'Entries', value: String(entries.length), detail: `${plural(days.length, 'day')} logged ${period}` },
    { label: 'Top symptom', value: symptoms[0] ? capitalize(symptoms[0][0]) : 'None', detail: symptoms[0] ? plural(symptoms[0][1], 'time') : undefined },
    { label: 'Average sleep', value: sleep !== null ? `${sleep} h` : 'No data' },
  ]
  const facts = [
    `Question type: general overview. Looking ${period}.`,
    `${plural(entries.length, 'entry', 'entries')} over ${plural(days.length, 'day')}.`,
    `Most common symptoms: ${symptoms.map(([l, n]) => `${l} (${n})`).join(', ') || 'none logged'}.`,
    `Most common food and drink: ${intake.map(([l, n]) => `${l} (${n})`).join(', ') || 'none logged'}.`,
    `Average sleep: ${sleep ?? 'not logged'}${sleep !== null ? ' hours' : ''}.`,
  ]
  return { plan, cards, facts, matchedDays: [], limited: days.length < 3 }
}

// ---------------------------------------------------------------------------
// Summary prompt

export function buildSummaryMessages(question: string, result: QueryResult): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: `You are a warm, careful health journaling assistant. Answer the person's question in 2 to 4 short sentences, using only the facts provided. Mention the key numbers. Describe patterns as associations in their logs, not causes. ${
        result.limited ? 'There is not much data yet, so say the pattern is uncertain and that logging for a few more days will help. ' : ''
      }Do not diagnose. If symptoms are frequent or severe, gently suggest talking to a doctor. Plain text only, no lists or markdown.`,
    },
    { role: 'user', content: `Question: ${question}\n\nFacts from my logs:\n${result.facts.map((f) => `- ${f}`).join('\n')}` },
  ]
}

// ---------------------------------------------------------------------------
// Helpers

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function listLabels(events: HealthEvent[]) {
  const top = topCounts(events.map((e) => e.label), 5)
  return top.length ? top.map(([l, n]) => `${l} (${n})`).join(', ') : 'none'
}

function partOfDay(d: Date) {
  const h = d.getHours()
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

export function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
