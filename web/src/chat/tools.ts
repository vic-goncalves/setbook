import { builtInExercises, matchesSearch } from '../domain/catalog'
import { dailyMeans, exerciseRecords, localDay, personalRecords, qualifyingSets } from '../domain/metrics'
import type { Equipment, Exercise, MassUnit, Measurement, MuscleGroup, RecordedMass, TemplateExercise, TemplateSet, WorkoutSession, WorkoutSet, WorkoutTemplate } from '../domain/types'
import { kilograms, localTimeZone, massIn, newId, nowIso, sameMeasurement } from '../domain/types'
import { currentPrefs } from '../prefs'
import { store, type Snapshot } from '../store'

/**
 * The coach's tools and the training snapshot, built to keep chats cheap:
 * - `trainingSnapshot` is attached to a chat's first message, so most questions are answered
 *   in one model call with no tool calls.
 * - Everything is compact text, not JSON: fewer input tokens on every later call.
 * - Exercises and templates are referred to by name, so Claude needs no lookups to build one.
 *
 * Names and inputs match the definitions the server sends (server/src/chat-prompt.ts). Reads
 * return text; writes return a Proposal, shown as an Approve/Decline card, applied on approval.
 */

export class ToolError extends Error {}

export interface Proposal {
  kind: 'proposal'
  title: string
  lines: string[]
  confirm: string
  danger?: boolean
  apply: () => unknown
}

type Input = Record<string, unknown>
type Handler = (input: Input, data: Snapshot) => unknown

const MAX_RESULT_CHARS = 12_000
const DEFAULT_REST = 90
const DAY_MS = 86_400_000

// MARK: Formatting

function unit(): MassUnit {
  return currentPrefs().unit
}

function round(value: number, digits = 1) {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function w(m: RecordedMass): number {
  return round(massIn(m, unit()))
}

function fromKg(kg: number): number {
  return round(massIn({ value: kg, unit: 'kg' }, unit()))
}

function today(): string {
  return localDay(new Date().toISOString(), localTimeZone())
}

function day(iso: string): string {
  return localDay(iso, localTimeZone())
}

function addDays(d: string, days: number): string {
  return new Date(Date.parse(`${d}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** "Nov 12" (adds the year when it isn't this year). */
function short(d: string): string {
  const date = new Date(`${d}T12:00:00Z`)
  const sameYear = d.slice(0, 4) === today().slice(0, 4)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
}

function weekOf(d: string): string {
  const weekday = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  return addDays(d, -weekday)
}

function setText(s: WorkoutSet): string {
  return s.load ? `${w(s.load)}x${s.reps}` : `x${s.reps}`
}

/** "185x5 x3, 180x6": repeated sets collapse. */
function setsText(sets: WorkoutSet[]): string {
  const out: [string, number][] = []
  for (const s of sets) {
    const t = setText(s)
    if (out.at(-1)?.[0] === t) out.at(-1)![1]++
    else out.push([t, 1])
  }
  return out.map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ')
}

function repText(t: { min: number; max: number } | undefined): string {
  if (!t) return 'any'
  return t.min === t.max ? `${t.min}` : `${t.min}-${t.max}`
}

function working(sets: WorkoutSet[], m: Measurement) {
  return qualifyingSets({ sessionId: '', sessionName: '', startedAt: '', measurement: m, sets })
}

function completed(data: Snapshot): WorkoutSession[] {
  return data.sessions.filter((s) => s.state === 'completed')
}

/** Epley; only for weight x reps sets up to 12 reps. */
function estimatedMax(s: WorkoutSet, m: Measurement): number | undefined {
  if (m.type !== 'external_load_reps' || !s.load || !s.reps || s.reps > 12) return undefined
  return kilograms(s.load) * (1 + s.reps / 30)
}

function bestE1rm(sets: WorkoutSet[], m: Measurement): number {
  return Math.max(0, ...sets.map((s) => estimatedMax(s, m) ?? 0))
}

function nameOf(data: Snapshot, id: string): string {
  return data.exerciseById.get(id.toUpperCase())?.name ?? 'Unknown exercise'
}

function templateLine(data: Snapshot, t: WorkoutTemplate): string {
  const parts = t.exercises.map((e) => {
    const sets = e.sets.filter((s) => s.type === 'working')
    const warm = e.sets.length - sets.length
    const reps = [...new Set(sets.map((s) => repText(s.targetReps)))].join('/')
    const loads = [...new Set(sets.map((s) => (s.targetLoad ? w(s.targetLoad) : undefined)).filter((v) => v !== undefined))]
    return `${nameOf(data, e.exerciseId)} ${sets.length}x${reps}${loads.length ? ` @${loads.join('/')}` : ''}${warm ? ` +${warm}wu` : ''}${e.restSeconds && e.restSeconds !== DEFAULT_REST ? ` r${e.restSeconds}` : ''}`
  })
  return `- ${t.name}: ${parts.join('; ')}`
}

// MARK: Names

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function allExercises(data: Snapshot): Exercise[] {
  return [...builtInExercises, ...data.customExercises.filter((e) => !e.archivedAt)]
}

/** Exact name (ignoring case and punctuation), else a unique partial match; else an error with suggestions. */
export function resolveExercise(data: Snapshot, name: unknown): Exercise {
  if (typeof name !== 'string' || !name.trim()) throw new ToolError('Give an exercise name.')
  const all = allExercises(data)
  const target = normal(name)
  const exact = all.filter((e) => normal(e.name) === target)
  if (exact.length) return exact.find((e) => !e.isBuiltIn) ?? exact[0]!
  const partial = all.filter((e) => normal(e.name).includes(target) || target.includes(normal(e.name)))
  if (partial.length === 1) return partial[0]!
  const words = target.split(' ')
  const close = all
    .map((e) => ({ e, score: words.filter((x) => normal(e.name).includes(x)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.e.name)
  throw new ToolError(`No exercise named "${name}".${close.length ? ` Closest: ${close.join('; ')}.` : ''} Use an exact name, or create_exercise.`)
}

function resolveTemplate(data: Snapshot, name: unknown): WorkoutTemplate {
  const target = typeof name === 'string' ? normal(name) : ''
  const match = data.templates.filter((t) => normal(t.name) === target)
  if (match.length === 1) return match[0]!
  if (match.length > 1) throw new ToolError(`More than one template is named "${String(name)}". Ask the user which one.`)
  throw new ToolError(`No template named "${String(name)}". Templates: ${data.templates.map((t) => t.name).join('; ') || 'none'}.`)
}

function optionalDay(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ToolError(`${field} must be YYYY-MM-DD.`)
  return value
}

// MARK: Snapshot

/**
 * A compact picture of the user's training for the first message of a chat. Sized to stay
 * around 2,000 tokens however much history there is.
 */
export function trainingSnapshot(data: Snapshot = store.getSnapshot()): string {
  const now = today()
  const done = completed(data)
  const lines: string[] = []
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  lines.push(`Today: ${date} (${localTimeZone()}). Weight unit: ${unit()}.`)
  lines.push(`Workouts logged: ${done.length}${done.length ? ` (first ${short(day(done.at(-1)!.startedAt))}, last ${short(day(done[0]!.startedAt))})` : ''}.`)
  const active = data.sessions.find((s) => s.state === 'active')
  if (active) lines.push(`Workout in progress: ${active.name}.`)

  lines.push('', 'Templates (exercise sets x reps, @target weight, +warm-ups, r=rest seconds if not 90):')
  lines.push(...(data.templates.length ? data.templates.slice(0, 15).map((t) => templateLine(data, t)) : ['- none']))

  // Recent workouts, newest first: last 3 weeks, at most 10.
  const recent = done.filter((s) => day(s.startedAt) >= addDays(now, -21)).slice(0, 10)
  lines.push('', 'Recent workouts (completed working sets, weight x reps):')
  if (!recent.length) lines.push('- none in the last 3 weeks')
  for (const s of recent) {
    const ex = s.exercises.map((e) => [e.exerciseName, working(e.sets, e.measurement)] as const).filter(([, sets]) => sets.length)
    lines.push(`- ${short(day(s.startedAt))} ${s.name}: ${ex.map(([n, sets]) => `${n} ${setsText(sets)}`).join('; ')}`)
  }

  // Lift trends: the most-logged exercises, first vs latest.
  const counts = new Map<string, number>()
  for (const s of done) for (const id of new Set(s.exercises.map((e) => e.exerciseId.toUpperCase()))) counts.set(id, (counts.get(id) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  if (top.length) {
    lines.push('', 'Lift trends (workouts; first -> latest; best ever):')
    for (const [id, n] of top) {
      const exercise = data.exerciseById.get(id)
      if (!exercise) continue
      const m = exercise.measurement
      const records = exerciseRecords(done, id).filter((r) => sameMeasurement(r.measurement, m))
      const points = records.map((r) => ({ d: day(r.startedAt), sets: qualifyingSets(r) })).filter((p) => p.sets.length)
      if (!points.length) continue
      const first = points[0]!
      const last = points.at(-1)!
      if (m.type === 'external_load_reps') {
        const e1 = (p: typeof first) => fromKg(bestE1rm(p.sets, m))
        const best = Math.max(...points.map(e1))
        lines.push(`- ${exercise.name} (${n}): est 1RM ${e1(first)} (${short(first.d)}) -> ${e1(last)} (${short(last.d)}); best ${best}`)
      } else {
        const reps = (p: typeof first) => Math.max(...p.sets.map((s) => s.reps ?? 0))
        lines.push(`- ${exercise.name} (${n}): best set ${reps(first)} reps (${short(first.d)}) -> ${reps(last)} (${short(last.d)})`)
      }
    }
  }

  // Weekly working sets per primary muscle, last 4 weeks (oldest first).
  const weeks = [3, 2, 1, 0].map((k) => addDays(weekOf(now), -7 * k))
  const perMuscle = new Map<string, number[]>()
  for (const s of done) {
    const wk = weeks.indexOf(weekOf(day(s.startedAt)))
    if (wk === -1) continue
    for (const e of s.exercises) {
      const n = working(e.sets, e.measurement).length
      if (!n) continue
      const muscle = data.exerciseById.get(e.exerciseId.toUpperCase())?.primaryMuscle ?? 'other'
      const row = perMuscle.get(muscle) ?? [0, 0, 0, 0]
      row[wk]! += n
      perMuscle.set(muscle, row)
    }
  }
  lines.push('', `Working sets per week by primary muscle (weeks of ${weeks.map(short).join(', ')}; last is this week so far):`)
  lines.push(perMuscle.size ? [...perMuscle.entries()].sort((a, b) => b[1].reduce((x, y) => x + y) - a[1].reduce((x, y) => x + y)).map(([m, r]) => `${m} ${r.join('/')}`).join('; ') : 'none')

  const daily = dailyMeans(data.measurements)
  if (daily.length) {
    const last = daily.at(-1)!
    const monthAgo = daily.filter((d) => d.day <= addDays(last.day, -28)).at(-1)
    lines.push('', `Body weight: ${fromKg(last.meanKilograms)} ${unit()} on ${short(last.day)}${monthAgo ? `, ${fromKg(monthAgo.meanKilograms)} on ${short(monthAgo.day)}` : ''}.`)
  }

  const custom = data.customExercises.filter((e) => !e.archivedAt)
  if (custom.length) lines.push('', `Their custom exercises: ${custom.map((e) => e.name).join('; ')}.`)
  return lines.join('\n')
}

// MARK: Reads

const workoutsTool: Handler = (input, data) => {
  const to = optionalDay(input.to, 'to') ?? today()
  const from = optionalDay(input.from, 'from') ?? addDays(to, -30)
  const only = input.exercise ? resolveExercise(data, input.exercise) : undefined
  const list = completed(data).filter((s) => {
    const d = day(s.startedAt)
    return d >= from && d <= to
  })
  const lines: string[] = []
  for (const s of list) {
    const ex = s.exercises
      .filter((e) => !only || e.exerciseId.toUpperCase() === only.id.toUpperCase())
      .map((e) => [e.exerciseName, working(e.sets, e.measurement)] as const)
      .filter(([, sets]) => sets.length)
    if (!ex.length) continue
    lines.push(`${short(day(s.startedAt))} ${s.name}: ${ex.map(([n, sets]) => (only ? setsText(sets) : `${n} ${setsText(sets)}`)).join('; ')}`)
    if (lines.length >= 40) break
  }
  const head = `Workouts ${short(from)} to ${short(to)}${only ? `, ${only.name} only` : ''} (${unit()}):`
  return lines.length ? [head, ...lines].join('\n') : `${head} none.`
}

const exerciseProgress: Handler = (input, data) => {
  const exercise = resolveExercise(data, input.exercise)
  const m = exercise.measurement
  const records = exerciseRecords(completed(data), exercise.id).filter((r) => sameMeasurement(r.measurement, m))
  const lines = [`${exercise.name} (${unit()}), oldest first: date top-set${m.type === 'external_load_reps' ? ' est1RM volume' : ' total-reps'}`]
  for (const r of records.slice(-30)) {
    const sets = qualifyingSets(r)
    if (!sets.length) continue
    const top = sets.reduce((a, b) => {
      const diff = (b.load ? kilograms(b.load) : 0) - (a.load ? kilograms(a.load) : 0)
      if (Math.abs(diff) >= 0.001) return (m.type === 'assisted_bodyweight_reps' ? diff < 0 : diff > 0) ? b : a
      return (b.reps ?? 0) > (a.reps ?? 0) ? b : a
    })
    const extra = m.type === 'external_load_reps'
      ? ` ${fromKg(bestE1rm(sets, m)) || '-'} ${fromKg(sets.reduce((sum, s) => sum + (s.load ? kilograms(s.load) : 0) * (s.reps ?? 0), 0))}`
      : ` ${sets.reduce((sum, s) => sum + (s.reps ?? 0), 0)}`
    lines.push(`${short(day(r.startedAt))} ${setText(top)}${extra}`)
  }
  if (lines.length === 1) return `${exercise.name}: no completed working sets yet.`
  const prs = personalRecords(records, m)
  const pr = (e: { load?: RecordedMass; reps: number; date: string } | undefined) => (e ? `${e.load ? `${w(e.load)}x${e.reps}` : `x${e.reps}`} (${short(day(e.date))})` : '-')
  lines.push(`Records: heaviest ${pr(prs.bestLoad)}; most reps ${pr(prs.mostReps)}`)
  return lines.join('\n')
}

const findExercises: Handler = (input, data) => {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  const muscle = typeof input.muscle === 'string' ? (input.muscle as MuscleGroup) : undefined
  const matches = allExercises(data).filter((e) => (!query || matchesSearch(e, query)) && (!muscle || e.primaryMuscle === muscle))
  if (!matches.length) return 'No matches. Create one with create_exercise if needed.'
  return matches.slice(0, 25).map((e) => `${e.name} (${e.primaryMuscle}, ${e.equipment.replace('_', ' ')}${e.isBuiltIn ? '' : ', custom'})`).join('\n')
}

// MARK: Writes

const measurementTypes = ['external_load_reps', 'bodyweight_reps', 'weighted_bodyweight_reps', 'assisted_bodyweight_reps'] as const

function parseReps(value: unknown, where: string): { min: number; max: number } {
  const text = String(value ?? '').trim()
  const m = text.match(/^(\d+)\s*(?:(?:-|–|to)\s*(\d+))?$/)
  const min = m ? Number(m[1]) : NaN
  const max = m?.[2] ? Number(m[2]) : min
  if (!Number.isInteger(min) || min < 1 || max < min || max > 100) throw new ToolError(`${where}: reps must be like "8" or "6-8".`)
  return { min, max }
}

const saveTemplate: Handler = (input, data): Proposal => {
  const existing = input.replaces ? resolveTemplate(data, input.replaces) : undefined
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 200) throw new ToolError('name is required (200 characters at most).')
  if (!existing && data.templates.some((t) => normal(t.name) === normal(name))) {
    throw new ToolError(`A template named "${name}" exists. To change it, set replaces to "${name}"; otherwise pick another name.`)
  }
  if (!Array.isArray(input.exercises) || input.exercises.length === 0 || input.exercises.length > 30) throw new ToolError('Give 1 to 30 exercises.')
  const lines: string[] = []
  const exercises: TemplateExercise[] = (input.exercises as Input[]).map((e) => {
    const exercise = resolveExercise(data, e.exercise)
    const where = exercise.name
    const count = Number(e.sets)
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new ToolError(`${where}: sets must be 1 to 20.`)
    const reps = parseReps(e.reps, where)
    const warmups = e.warmup_sets == null ? 0 : Number(e.warmup_sets)
    if (!Number.isInteger(warmups) || warmups < 0 || warmups > 10) throw new ToolError(`${where}: warmup_sets must be 0 to 10.`)
    const rest = e.rest_seconds == null ? DEFAULT_REST : Number(e.rest_seconds)
    if (!Number.isInteger(rest) || rest < 1 || rest > 1800) throw new ToolError(`${where}: rest_seconds must be 1 to 1800.`)
    let targetLoad: RecordedMass | undefined
    if (e.weight != null) {
      const value = Number(e.weight)
      if (!Number.isFinite(value) || value < 0) throw new ToolError(`${where}: weight can't be negative.`)
      if (exercise.measurement.loadConvention === undefined) throw new ToolError(`${where} is bodyweight only, so it takes no weight.`)
      targetLoad = { value, unit: unit() }
    }
    const sets: TemplateSet[] = [
      ...Array.from({ length: warmups }, (): TemplateSet => ({ id: newId(), type: 'warmup' })),
      ...Array.from({ length: count }, (): TemplateSet => ({ id: newId(), type: 'working', targetReps: reps, ...(targetLoad ? { targetLoad } : {}) })),
    ]
    lines.push(`${exercise.name}: ${count} x ${repText(reps)}${targetLoad ? ` at ${targetLoad.value} ${unit()}` : ''}${warmups ? ` + ${warmups} warm-up` : ''}`)
    return { id: newId(), exerciseId: exercise.id, restSeconds: rest, sets }
  })
  const now = nowIso()
  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : undefined
  const template: WorkoutTemplate = {
    id: existing?.id ?? newId(),
    name,
    ...(notes ? { notes } : {}),
    revision: existing ? existing.revision + 1 : 1,
    exercises,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const setCount = exercises.reduce((n, e) => n + e.sets.filter((s) => s.type === 'working').length, 0)
  return {
    kind: 'proposal',
    title: existing ? `Update “${existing.name}”` : `Create “${name}”`,
    lines: [...(existing && existing.name !== name ? [`Renamed to “${name}”`] : []), ...lines, `${exercises.length} exercises, ${setCount} working sets`],
    confirm: existing ? 'Update' : 'Create',
    apply: () => {
      store.save('template', template)
      return { saved: true, template_id: template.id, name: template.name }
    },
  }
}

const deleteTemplate: Handler = (input, data): Proposal => {
  const template = resolveTemplate(data, input.name)
  return {
    kind: 'proposal',
    title: `Delete “${template.name}”`,
    lines: [`${template.exercises.length} exercises. Past workouts started from it are kept.`],
    confirm: 'Delete',
    danger: true,
    apply: () => {
      store.remove('template', template.id)
      return `Deleted "${template.name}".`
    },
  }
}

function describeMeasurement(m: Measurement): string {
  switch (m.type) {
    case 'external_load_reps': return m.loadConvention === 'per_hand' ? 'weight x reps, per hand' : 'weight x reps'
    case 'bodyweight_reps': return 'reps only'
    case 'weighted_bodyweight_reps': return 'added weight x reps'
    case 'assisted_bodyweight_reps': return 'assistance x reps'
  }
}

const createExercise: Handler = (input, data): Proposal => {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 200) throw new ToolError('name is required (200 characters at most).')
  const duplicate = allExercises(data).find((e) => normal(e.name) === normal(name))
  if (duplicate) throw new ToolError(`"${duplicate.name}" already exists. Use it.`)
  const type = input.measurement_type as Measurement['type']
  if (!measurementTypes.includes(type)) throw new ToolError('Unknown measurement_type.')
  let measurement: Measurement
  if (type === 'external_load_reps') {
    if (input.load_convention !== 'total' && input.load_convention !== 'per_hand') throw new ToolError('external_load_reps needs load_convention "total" or "per_hand".')
    measurement = { type, loadConvention: input.load_convention }
  } else {
    measurement = type === 'bodyweight_reps' ? { type } : { type, loadConvention: type === 'weighted_bodyweight_reps' ? 'added' : 'assistance' }
  }
  const now = nowIso()
  const exercise: Exercise = {
    id: newId(),
    name,
    primaryMuscle: input.primary_muscle as MuscleGroup,
    secondaryMuscles: [],
    equipment: input.equipment as Equipment,
    measurement,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  }
  return {
    kind: 'proposal',
    title: `Add exercise “${name}”`,
    lines: [`${exercise.primaryMuscle.replace('_', ' ')}, ${exercise.equipment.replace('_', ' ')}`, describeMeasurement(measurement)],
    confirm: 'Add',
    apply: () => {
      store.save('exercise', exercise)
      return `Added "${name}".`
    },
  }
}

// MARK: Registry

const handlers: Record<string, Handler> = {
  workouts: workoutsTool,
  exercise_progress: exerciseProgress,
  find_exercises: findExercises,
  save_template: saveTemplate,
  delete_template: deleteTemplate,
  create_exercise: createExercise,
}

/** What the chat shows while a tool runs. */
export const toolActivity: Record<string, string> = {
  workouts: 'Looking at your workouts',
  exercise_progress: 'Checking your progress',
  find_exercises: 'Searching exercises',
  save_template: 'Preparing a template',
  delete_template: 'Preparing to delete a template',
  create_exercise: 'Preparing a new exercise',
}

export type ToolOutcome = { kind: 'result'; content: string } | { kind: 'error'; content: string } | Proposal

/** Runs a tool by name. Never throws: bad input comes back as an error for Claude to fix. */
export function runTool(name: string, input: unknown, data: Snapshot = store.getSnapshot()): ToolOutcome {
  const handler = handlers[name]
  if (!handler) return { kind: 'error', content: `Unknown tool "${name}". Available: ${Object.keys(handlers).join(', ')}.` }
  try {
    const value = handler((input ?? {}) as Input, data)
    if (value && typeof value === 'object' && (value as Proposal).kind === 'proposal') return value as Proposal
    return { kind: 'result', content: serialize(value) }
  } catch (error) {
    if (error instanceof ToolError) return { kind: 'error', content: error.message }
    console.error(`Tool ${name} failed`, error)
    return { kind: 'error', content: `The tool failed: ${(error as Error).message}` }
  }
}

export function serialize(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= MAX_RESULT_CHARS) return text
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: ask for a shorter date range]`
}
