import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm'
import { PARSED_LOG_JSON_SCHEMA, sanitizeParsedLog, type ParsedLog } from './schema'

const SYSTEM_PROMPT = `You turn a person's informal health note into JSON. Only record what the note says. Never invent items.

Fields:
- intake: every food, drink, medicine or supplement they had. "item" is a short lowercase name ("double espresso", "chicken sandwich"). "category" is "beverage" for any drink, "medication" for medicines and supplements, otherwise "food".
- activities: exercise and notable activities (walk, run, gym, yoga, long drive). "duration_mins" is a whole number of minutes, or null if not given.
- symptoms: each physical or mental symptom. "type" is a short lowercase name ("stomach pain", "headache", "anxiety"). "severity" is "mild" for slight or minor, "severe" for intense, terrible or unbearable, otherwise "moderate". "location" is the body part, or "".
- time: 24-hour "HH:MM" when the note says when it happened ("2pm" is "14:00", "around 4 in the afternoon" is "16:00", breakfast "08:00", lunch "13:00", dinner "19:00"). If a symptom came "after" something with a known time and no other time is given, leave it "". Otherwise use "".
- sleep_hours: hours slept, as a number, or null if sleep is not mentioned.
- general_notes: a short phrase for anything else useful (mood, stress, context), or "".`

const EXAMPLE_NOTE =
  'slept badly, maybe 5 hrs. oatmeal and green tea for breakfast, 30 min walk at lunch. slight headache around 3pm, took 2 ibuprofen. stressed about work'

const EXAMPLE_OUTPUT: ParsedLog = {
  intake: [
    { item: 'oatmeal', category: 'food', time: '08:00' },
    { item: 'green tea', category: 'beverage', time: '08:00' },
    { item: 'ibuprofen', category: 'medication', time: '15:00' },
  ],
  activities: [{ type: 'walk', duration_mins: 30, time: '13:00' }],
  symptoms: [{ type: 'headache', severity: 'mild', location: 'head', time: '15:00' }],
  sleep_hours: 5,
  general_notes: 'slept badly, stressed about work',
}

const SCHEMA = JSON.stringify(PARSED_LOG_JSON_SCHEMA)

function describeWhen(when: Date): string {
  return when.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function buildParseMessages(note: string, when: Date): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Note written ${describeWhen(new Date(2026, 0, 12, 21, 30))}:\n${EXAMPLE_NOTE}` },
    { role: 'assistant', content: JSON.stringify(EXAMPLE_OUTPUT) },
    { role: 'user', content: `Note written ${describeWhen(when)}:\n${note.trim()}` },
  ]
}

type Chat = (
  messages: ChatCompletionMessageParam[],
  options: { jsonSchema?: string; maxTokens?: number; onToken?: (text: string) => void },
) => Promise<string>

export async function parseNote(
  chat: Chat,
  note: string,
  when: Date,
  onToken?: (text: string) => void,
): Promise<ParsedLog> {
  const text = await chat(buildParseMessages(note, when), { jsonSchema: SCHEMA, maxTokens: 800, onToken })
  try {
    return sanitizeParsedLog(JSON.parse(text))
  } catch {
    throw new Error('The model returned something that could not be read. Please try again.')
  }
}
