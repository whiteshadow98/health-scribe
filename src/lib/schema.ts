// Shape of a parsed health log, the JSON schema the model is constrained to,
// and a sanitizer that coerces model output into that shape.

export const INTAKE_CATEGORIES = ['food', 'beverage', 'medication'] as const
export const SEVERITIES = ['mild', 'moderate', 'severe'] as const

export type IntakeCategory = (typeof INTAKE_CATEGORIES)[number]
export type Severity = (typeof SEVERITIES)[number]

export type Intake = { item: string; category: IntakeCategory; time: string }
export type Activity = { type: string; duration_mins: number | null; time: string }
export type Symptom = { type: string; severity: Severity; location: string; time: string }

/** What the model produces from a note. Times are "HH:MM" (24h) or "" when not mentioned. */
export type ParsedLog = {
  intake: Intake[]
  activities: Activity[]
  symptoms: Symptom[]
  sleep_hours: number | null
  general_notes: string
}

/** What is stored in IndexedDB. */
export type LogEntry = ParsedLog & {
  id?: number
  /** ISO string for when the note applies (defaults to when it was written). */
  timestamp: string
  /** Local calendar day, YYYY-MM-DD, used for grouping and day-level analytics. */
  day: string
  raw_note: string
  model: string
  created_at: string
}

const timeField = { type: 'string', pattern: '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' }

// Passed to WebLLM's constrained decoding, so the model can only emit JSON of this shape.
export const PARSED_LOG_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intake: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          category: { type: 'string', enum: [...INTAKE_CATEGORIES] },
          time: timeField,
        },
        required: ['item', 'category', 'time'],
      },
    },
    activities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          duration_mins: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          time: timeField,
        },
        required: ['type', 'duration_mins', 'time'],
      },
    },
    symptoms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          severity: { type: 'string', enum: [...SEVERITIES] },
          location: { type: 'string' },
          time: timeField,
        },
        required: ['type', 'severity', 'location', 'time'],
      },
    },
    sleep_hours: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    general_notes: { type: 'string' },
  },
  required: ['intake', 'activities', 'symptoms', 'sleep_hours', 'general_notes'],
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asTime(value: unknown): string {
  const match = asString(value).match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ''
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

function asNumber(value: unknown, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (value === null || value === '' || !Number.isFinite(n) || n < 0 || n > max) return null
  return Math.round(n * 10) / 10
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const s = asString(value).toLowerCase()
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : []
}

/** Coerces anything the model returns into a valid ParsedLog. Never throws. */
export function sanitizeParsedLog(raw: unknown): ParsedLog {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    intake: asArray(obj.intake)
      .map((i) => ({
        item: asString(i.item),
        category: asEnum(i.category, INTAKE_CATEGORIES, 'food'),
        time: asTime(i.time),
      }))
      .filter((i) => i.item),
    activities: asArray(obj.activities)
      .map((a) => ({
        type: asString(a.type),
        duration_mins: asNumber(a.duration_mins, 24 * 60),
        time: asTime(a.time),
      }))
      .filter((a) => a.type),
    symptoms: asArray(obj.symptoms)
      .map((s) => ({
        type: asString(s.type),
        severity: asEnum(s.severity, SEVERITIES, 'mild'),
        location: asString(s.location),
        time: asTime(s.time),
      }))
      .filter((s) => s.type),
    sleep_hours: asNumber(obj.sleep_hours, 24),
    general_notes: asString(obj.general_notes),
  }
}

export function isEmptyLog(log: ParsedLog): boolean {
  return (
    !log.intake.length && !log.activities.length && !log.symptoms.length && log.sleep_hours === null && !log.general_notes
  )
}
