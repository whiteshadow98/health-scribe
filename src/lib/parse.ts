import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm'
import prompts from './prompts.json'
import { PARSED_LOG_JSON_SCHEMA, sanitizeParsedLog, type ParsedLog } from './schema'

const SYSTEM_PROMPT = prompts.parse_system

const EXAMPLE_NOTE = prompts.parse_example_note
const EXAMPLE_OUTPUT = prompts.parse_example_output as ParsedLog

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

/** `fewShot` adds a worked example; the fine-tuned model is trained without one. */
export function buildParseMessages(note: string, when: Date, fewShot = true): ChatCompletionMessageParam[] {
  const example: ChatCompletionMessageParam[] = fewShot
    ? [
        { role: 'user', content: `Note written ${describeWhen(new Date(2026, 0, 12, 21, 30))}:\n${EXAMPLE_NOTE}` },
        { role: 'assistant', content: JSON.stringify(EXAMPLE_OUTPUT) },
      ]
    : []
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...example,
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
  fewShot = true,
): Promise<ParsedLog> {
  const text = await chat(buildParseMessages(note, when, fewShot), { jsonSchema: SCHEMA, maxTokens: 800, onToken })
  try {
    return sanitizeParsedLog(JSON.parse(text))
  } catch {
    throw new Error('The model returned something that could not be read. Please try again.')
  }
}
