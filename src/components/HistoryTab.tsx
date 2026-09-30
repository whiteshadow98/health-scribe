import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Check, Pencil, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { db, deleteEntry, localDay, updateEntry } from '../lib/db'
import type { LogEntry } from '../lib/schema'
import { LogDetails } from './LogDetails'

type Filter = 'all' | 'symptoms' | 'intake' | 'activities' | 'sleep'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'symptoms', label: 'Symptoms' },
  { id: 'intake', label: 'Food & drink' },
  { id: 'activities', label: 'Activity' },
  { id: 'sleep', label: 'Sleep' },
]

export function HistoryTab() {
  const entries = useLiveQuery(() => db.entries.orderBy('timestamp').reverse().toArray(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const visible = (entries ?? []).filter((e) => matchesFilter(e, filter) && (!q || entryText(e).includes(q)))
    const byDay = new Map<string, LogEntry[]>()
    for (const e of visible) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e])
    return [...byDay.entries()]
  }, [entries, filter, search])

  if (entries === undefined) return null

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <CalendarDays className="mx-auto size-10 text-slate-300" aria-hidden />
        <p className="mt-3 font-semibold text-slate-900">No entries yet</p>
        <p className="mt-1 text-sm text-slate-500">Your logs will appear here, grouped by day.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your logs"
            className="w-full rounded-xl border-0 bg-white py-2.5 pl-9 pr-3 text-base ring-1 ring-slate-200 focus:ring-2 focus:ring-teal-600 focus:outline-none"
          />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                filter === f.id ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-slate-700 ring-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No entries match this filter.</p>}

      {groups.map(([day, dayEntries]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">{dayHeading(day)}</h2>
          <div className="space-y-3">
            {dayEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function EntryCard({ entry }: { entry: LogEntry }) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showNote, setShowNote] = useState(false)

  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  function removeItem(list: 'intake' | 'activities' | 'symptoms', index: number) {
    updateEntry(entry.id!, { [list]: entry[list].filter((_, i) => i !== index) })
  }

  function setSleep(value: string) {
    const n = Number(value)
    updateEntry(entry.id!, { sleep_hours: value === '' || !Number.isFinite(n) ? null : Math.min(24, Math.max(0, n)) })
  }

  return (
    <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{time}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setEditing((v) => !v)
              setConfirmDelete(false)
            }}
            className={`rounded-lg p-2 ${editing ? 'bg-teal-50 text-teal-700' : 'text-slate-500'}`}
            aria-label={editing ? 'Done editing' : 'Edit entry'}
          >
            {editing ? <Check className="size-4" aria-hidden /> : <Pencil className="size-4" aria-hidden />}
          </button>
          {confirmDelete ? (
            <button
              onClick={() => deleteEntry(entry.id!)}
              className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              Delete?
            </button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="rounded-lg p-2 text-slate-500" aria-label="Delete entry">
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <LogDetails log={entry} onRemove={editing ? removeItem : undefined} />

      {editing && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
          <label htmlFor={`sleep-${entry.id}`} className="text-slate-600">
            Sleep hours
          </label>
          <input
            id={`sleep-${entry.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            max={24}
            step={0.5}
            defaultValue={entry.sleep_hours ?? ''}
            onBlur={(e) => setSleep(e.target.value)}
            className="w-20 rounded-md border-0 bg-white px-2 py-1 ring-1 ring-slate-200"
          />
          <span className="text-xs text-slate-500">Tap × on an item to remove it.</span>
        </div>
      )}

      <button onClick={() => setShowNote((v) => !v)} className="mt-3 text-xs font-medium text-slate-500">
        {showNote ? 'Hide original note' : 'Show original note'}
      </button>
      {showNote && <p className="mt-1 text-sm italic text-slate-600">“{entry.raw_note}”</p>}
    </article>
  )
}

function matchesFilter(e: LogEntry, filter: Filter) {
  switch (filter) {
    case 'symptoms':
      return e.symptoms.length > 0
    case 'intake':
      return e.intake.length > 0
    case 'activities':
      return e.activities.length > 0
    case 'sleep':
      return e.sleep_hours !== null
    default:
      return true
  }
}

function entryText(e: LogEntry) {
  return [
    e.raw_note,
    e.general_notes,
    ...e.intake.map((i) => i.item),
    ...e.activities.map((a) => a.type),
    ...e.symptoms.map((s) => `${s.type} ${s.location}`),
  ]
    .join(' ')
    .toLowerCase()
}

function dayHeading(day: string) {
  const today = localDay(new Date())
  const yesterday = localDay(new Date(Date.now() - 86400000))
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
