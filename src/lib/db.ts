import Dexie, { type EntityTable } from 'dexie'
import { sanitizeParsedLog, type LogEntry } from './schema'

// All health data lives here, in this browser's IndexedDB. Nothing is sent anywhere.
export const db = new Dexie('health-scribe') as Dexie & {
  entries: EntityTable<LogEntry, 'id'>
}

db.version(1).stores({
  entries: '++id, timestamp, day',
})

export function localDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function saveEntry(entry: Omit<LogEntry, 'id' | 'day'>): Promise<number> {
  const id = await db.entries.add({ ...entry, day: localDay(new Date(entry.timestamp)) })
  // Ask Chrome to keep this site's data even when the phone is low on space.
  requestPersistentStorage()
  return id as number
}

export function updateEntry(id: number, changes: Partial<LogEntry>) {
  const next = { ...changes }
  if (changes.timestamp) next.day = localDay(new Date(changes.timestamp))
  return db.entries.update(id, next)
}

export function deleteEntry(id: number) {
  return db.entries.delete(id)
}

export function allEntries(): Promise<LogEntry[]> {
  return db.entries.orderBy('timestamp').toArray()
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

const BACKUP_FORMAT = 'health-scribe-backup'

export async function exportBackup(): Promise<Blob> {
  const entries = await allEntries()
  const payload = { format: BACKUP_FORMAT, version: 1, exported_at: new Date().toISOString(), entries }
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
}

/** Imports a backup file, skipping entries that already exist (same timestamp and note). */
export async function importBackup(file: File): Promise<{ added: number; skipped: number }> {
  const payload = JSON.parse(await file.text())
  if (payload?.format !== BACKUP_FORMAT || !Array.isArray(payload.entries)) {
    throw new Error('This file is not a Health Scribe backup.')
  }

  const existing = new Set((await allEntries()).map((e) => `${e.timestamp}|${e.raw_note}`))
  const fresh: LogEntry[] = []
  for (const raw of payload.entries) {
    const timestamp = typeof raw?.timestamp === 'string' ? raw.timestamp : ''
    if (Number.isNaN(Date.parse(timestamp))) continue
    const raw_note = typeof raw.raw_note === 'string' ? raw.raw_note : ''
    const key = `${timestamp}|${raw_note}`
    if (existing.has(key)) continue
    existing.add(key)
    fresh.push({
      ...sanitizeParsedLog(raw),
      timestamp,
      day: localDay(new Date(timestamp)),
      raw_note,
      model: typeof raw.model === 'string' ? raw.model : 'imported',
      created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    })
  }

  await db.entries.bulkAdd(fresh)
  return { added: fresh.length, skipped: payload.entries.length - fresh.length }
}
