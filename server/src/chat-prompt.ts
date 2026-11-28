import type Anthropic from '@anthropic-ai/sdk'
import catalog from '../../contracts/catalog.json'
import { equipment, muscleGroups } from './records'

/**
 * The coach's instructions and tools, built for low cost:
 * - The browser attaches a compact snapshot of the user's training to the first message, so
 *   most questions are answered in one model call with no tool calls.
 * - Exercises are referred to by name, and the built-in names are listed here (cached with
 *   the rest of the prompt), so building a template needs no lookup first.
 * - Templates are written one line per exercise, not one object per set: far fewer output
 *   tokens, which cost five times more than input.
 *
 * The tools run in the browser (web/src/chat/tools.ts); keep names and inputs in step with it.
 * Editing this invalidates the prompt cache once and drops earlier reasoning in open chats.
 */

const builtInsByMuscle = (() => {
  const groups = new Map<string, string[]>()
  for (const e of catalog) groups.set(e.primaryMuscle, [...(groups.get(e.primaryMuscle) ?? []), e.name])
  return [...groups.entries()].map(([muscle, names]) => `- ${muscle}: ${names.join('; ')}`).join('\n')
})()

export const chatSystemPrompt = `You are the coach in Setbook, a strength-training log. You help one person understand their training and plan it.

# How you work
- The first user message has a <context> block: today's date, their weight unit, their templates, recent workouts, lift trends, weekly sets per muscle and body weight. Answer from it whenever it has what you need, without calling tools. It reflects the moment the chat started.
- Use a tool only for what the context lacks: older workouts or every set of a lift (workouts, exercise_progress), or exercises not listed below (find_exercises).
- Use their weight unit everywhere. Never guess numbers that aren't in the context or a tool result; say when there isn't enough data.
- save_template, delete_template and create_exercise show the user an Approve/Decline card. Call them when ready instead of asking "shall I?". If they decline, ask what to change.
- To edit a template, send the complete new version to save_template with replaces set to its current name.

# Exercises
Refer to exercises by exact name. Prefer ones they already log (in the context), then these built-ins. Create a custom exercise only when nothing fits.
${builtInsByMuscle}

Measurement: most exercises are weight x reps. "(Dumbbell)" exercises are logged per dumbbell (per hand). Pull-up, Chin-up, Dip, Push-up, Crunch, Hanging Leg Raise, Ab Wheel Rollout and Back Extension are bodyweight (reps only, no weight); their "(Weighted)" versions log added weight and "(Assisted)" versions log assistance (lower is harder). Only completed working sets count toward progress. Estimated 1RM uses Epley (valid to about 12 reps); say "estimated".

# Writing
They read on a phone. Lead with the answer in a few short lines or a short list, with real numbers and dates ("185x5 on Nov 12, up from 175x5 on Oct 3"). **Bold** sparingly; no tables or big headings. For a program, one sentence of reasoning per day. Practical, conservative advice; for pain or injury, suggest a professional.`

/**
 * Strict schemas (guaranteed-valid input) for the tools that change data. The API caps strict
 * schemas at 16 nullable parameters in total; read-only tools use plain optional parameters,
 * which the browser validates anyway.
 */
export const MAX_STRICT_UNIONS = 16

const nullable = (schema: Record<string, unknown>, description?: string) => ({ anyOf: [schema, { type: 'null' }], ...(description ? { description } : {}) })
const day = (what: string) => ({ type: 'string', description: `${what}, YYYY-MM-DD.` })
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

const writeTool = (name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema: object(properties),
  strict: true,
})

const readTool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema: object(properties, required),
})

export const chatTools: Anthropic.Beta.BetaTool[] = [
  readTool('workouts', 'Completed workouts as compact lines (date, name, working sets per exercise), newest first. Default: last 30 days.', {
    from: day('Earliest day'),
    to: day('Latest day'),
    exercise: { type: 'string', description: 'Only this exercise (name).' },
  }),
  readTool('exercise_progress', 'One exercise over time: per workout the top set, estimated 1RM and volume; plus records.', {
    exercise: { type: 'string', description: 'Exercise name.' },
  }, ['exercise']),
  readTool('find_exercises', "Search exercise names (built-in and custom) when one you need isn't listed.", {
    query: { type: 'string' },
    muscle: { type: 'string', enum: [...muscleGroups] },
  }),
  writeTool('save_template', 'Create a template, or replace one completely. The user approves it first.', {
    name: { type: 'string' },
    replaces: nullable({ type: 'string' }, 'Name of the template this replaces, or null for a new one.'),
    notes: nullable({ type: 'string' }),
    exercises: {
      type: 'array',
      items: object({
        exercise: { type: 'string', description: 'Exact exercise name.' },
        sets: { type: 'integer', description: 'Working sets.' },
        reps: { type: 'string', description: 'Target reps: "8" or a range like "6-8".' },
        weight: nullable({ type: 'number' }, 'Target weight in their unit, or null.'),
        warmup_sets: nullable({ type: 'integer' }, 'Warm-up sets before the working sets, or null for none.'),
        rest_seconds: nullable({ type: 'integer' }, 'Rest between sets, or null for 90.'),
      }),
    },
  }),
  writeTool('delete_template', 'Delete a template by name. Past workouts are kept. The user approves it first.', {
    name: { type: 'string' },
  }),
  writeTool('create_exercise', 'Add a custom exercise when nothing fits. The user approves it first.', {
    name: { type: 'string' },
    primary_muscle: { type: 'string', enum: [...muscleGroups] },
    equipment: { type: 'string', enum: [...equipment] },
    measurement_type: { type: 'string', enum: ['external_load_reps', 'bodyweight_reps', 'weighted_bodyweight_reps', 'assisted_bodyweight_reps'] },
    load_convention: nullable({ type: 'string', enum: ['total', 'per_hand'] }, '"total" or "per_hand" for external_load_reps; null otherwise.'),
  }),
]
