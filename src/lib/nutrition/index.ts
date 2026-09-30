// Estimates nutrition for logged food and drink from the bundled food table.
// The model only extracts what was eaten and how much; every number comes from foods.json.

import table from './foods.json'
import type { Intake, LogEntry } from '../schema'

export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fibre', 'iron', 'calcium', 'b12'] as const
export type Nutrient = (typeof NUTRIENTS)[number]
export type Nutrition = Record<Nutrient, number>

export const NUTRIENT_INFO: Record<Nutrient, { label: string; unit: string }> = {
  kcal: { label: 'Calories', unit: 'kcal' },
  protein: { label: 'Protein', unit: 'g' },
  carbs: { label: 'Carbs', unit: 'g' },
  fat: { label: 'Fat', unit: 'g' },
  fibre: { label: 'Fibre', unit: 'g' },
  iron: { label: 'Iron', unit: 'mg' },
  calcium: { label: 'Calcium', unit: 'mg' },
  b12: { label: 'Vitamin B12', unit: 'mcg' },
}

export type Profile = 'female' | 'male' | 'average'

/** Daily targets for a sedentary adult, based on ICMR-NIN 2020 recommendations. */
export const DAILY_TARGETS: Record<Profile, Nutrition> = {
  female: { kcal: 1660, protein: 46, carbs: 230, fat: 55, fibre: 25, iron: 29, calcium: 1000, b12: 2.5 },
  male: { kcal: 2110, protein: 54, carbs: 290, fat: 70, fibre: 30, iron: 19, calcium: 1000, b12: 2.5 },
  average: { kcal: 1880, protein: 50, carbs: 260, fat: 62, fibre: 28, iron: 24, calcium: 1000, b12: 2.5 },
}

type Food = { name: string; unit: string; grams: number; values: Nutrition }

const FOODS: Food[] = table.foods.map((row) => {
  const [name, , unit, grams, ...values] = row as [string, string[], string, number, ...number[]]
  return { name, unit, grams, values: Object.fromEntries(NUTRIENTS.map((n, i) => [n, values[i]])) as Nutrition }
})

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9éã ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Every name and alias, longest first, so "chicken biryani" beats "biryani" and "masala dosa" beats "dosa".
const NAMES: [string, Food][] = table.foods
  .flatMap((row, i) => [row[0] as string, ...(row[1] as string[])].map((n) => [normalize(n), FOODS[i]] as [string, Food]))
  .sort((a, b) => b[0].length - a[0].length)
const EXACT = new Map(NAMES)

export function findFood(item: string): Food | null {
  const name = normalize(item)
  if (!name) return null
  const exact = EXACT.get(name) ?? EXACT.get(name.replace(/s$/, '')) ?? EXACT.get(name.replace(/es$/, ''))
  if (exact) return exact
  // "spicy chicken curry" -> "chicken curry", "bread pakora" -> "bread pakora", "dal fry" -> "dal".
  for (const [alias, food] of NAMES) {
    if (alias.length >= 3 && new RegExp(`(^| )${alias}s?( |$)`).test(name)) return food
  }
  return null
}

/** Grams (or ml) per unit when converting between different serving shapes. */
const UNIT_GRAMS: Record<string, number> = {
  bowl: 150, plate: 250, cup: 150, glass: 250, bottle: 500, slice: 30, scoop: 30, spoon: 10, peg: 30, pint: 470,
  packet: 50, g: 1, ml: 1, l: 1000,
}

/** How many of the food's standard servings this intake item represents. */
export function servings(item: Intake, food: Food): number {
  const qty = item.quantity ?? 1
  const unit = item.unit
  if (!unit || unit === 'serving' || unit === 'tablet' || unit === 'capsule' || unit === food.unit) return qty
  const grams = UNIT_GRAMS[unit]
  return grams ? (qty * grams) / food.grams : qty
}

export type ItemNutrition = { item: string; food: string; servings: number; nutrition: Nutrition }

export function itemNutrition(item: Intake): ItemNutrition | null {
  if (item.category === 'medication') return null
  const food = findFood(item.item)
  if (!food) return null
  const s = servings(item, food)
  const nutrition = Object.fromEntries(NUTRIENTS.map((n) => [n, food.values[n] * s])) as Nutrition
  return { item: item.item, food: food.name, servings: s, nutrition }
}

export function emptyNutrition(): Nutrition {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, 0])) as Nutrition
}

export function addNutrition(a: Nutrition, b: Nutrition): Nutrition {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, a[n] + b[n]])) as Nutrition
}

export type EntryNutrition = { total: Nutrition; items: ItemNutrition[]; unmatched: string[] }

export function entryNutrition(entry: Pick<LogEntry, 'intake'>): EntryNutrition {
  const items: ItemNutrition[] = []
  const unmatched: string[] = []
  for (const i of entry.intake) {
    const n = itemNutrition(i)
    if (n) items.push(n)
    else if (i.category !== 'medication') unmatched.push(i.item)
  }
  return { total: items.reduce((t, i) => addNutrition(t, i.nutrition), emptyNutrition()), items, unmatched }
}

export type DayNutrition = { day: string; total: Nutrition; items: ItemNutrition[] }

/** Totals per day, only for days where at least one food or drink was recognised. */
export function dailyNutrition(entries: LogEntry[]): DayNutrition[] {
  const byDay = new Map<string, DayNutrition>()
  for (const e of entries) {
    const n = entryNutrition(e)
    if (!n.items.length) continue
    const day = byDay.get(e.day) ?? { day: e.day, total: emptyNutrition(), items: [] }
    day.total = addNutrition(day.total, n.total)
    day.items.push(...n.items)
    byDay.set(e.day, day)
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function averageNutrition(days: DayNutrition[]): Nutrition {
  if (!days.length) return emptyNutrition()
  const sum = days.reduce((t, d) => addNutrition(t, d.total), emptyNutrition())
  return Object.fromEntries(NUTRIENTS.map((n) => [n, sum[n] / days.length])) as Nutrition
}

export function formatAmount(n: Nutrient, value: number) {
  const { unit } = NUTRIENT_INFO[n]
  const rounded = n === 'b12' ? Math.round(value * 10) / 10 : value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${unit}`
}

/** Maps a question's nutrient word ("calories", "protein", "fiber") to a Nutrient, or null for "all". */
export function toNutrient(word: string): Nutrient | null {
  const w = word.toLowerCase()
  if (/cal|kcal|energy/.test(w)) return 'kcal'
  if (/prot/.test(w)) return 'protein'
  if (/carb|sugar/.test(w)) return 'carbs'
  if (/fat/.test(w)) return 'fat'
  if (/fib/.test(w)) return 'fibre'
  if (/iron|haem|hem/.test(w)) return 'iron'
  if (/calc/.test(w)) return 'calcium'
  if (/b12|b 12|cobal/.test(w)) return 'b12'
  return null
}

const PROFILE_KEY = 'health-scribe:profile'

export function getProfile(): Profile {
  try {
    const v = localStorage.getItem(PROFILE_KEY)
    return v === 'female' || v === 'male' ? v : 'average'
  } catch {
    return 'average'
  }
}

export function setProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, p)
  } catch {
    // Not remembered; targets fall back to the average.
  }
}
