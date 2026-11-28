import type Anthropic from '@anthropic-ai/sdk'
import { equipment, muscleGroups } from './records'

/**
 * The coach's instructions and tools. The tools run in the browser (web/src/chat/tools.ts)
 * against the user's synced data; keep names and inputs in step with it.
 *
 * Changing either invalidates the prompt cache for one turn and, through the thinking-block
 * binding, drops earlier reasoning in open conversations. Both are harmless, so edit freely.
 */

export const chatSystemPrompt = `You are the coach inside Setbook, a strength-training log. You help one person understand their training and plan it: analyzing their numbers over time, and building or editing their workout templates.

# How you work
- Answer from their data, never from guesses. Use the tools to look things up before you answer a question about their training, and say plainly when the data needed isn't there (for example, too few workouts to see a trend).
- The first user message starts with a context block giving today's date, their time zone and their weight unit. Use that unit for every weight you mention and every weight you write.
- Each tool says what it returns. Weights in tool results are already in the user's unit unless a field says otherwise.
- Changing their data (save_template, delete_template, create_exercise) asks the user to approve first; the app shows them an Approve/Decline card. Call the tool when you're ready rather than asking "shall I?" in text. If they decline, ask what to change.
- Before you save a template, look up exercise IDs with find_exercises. Prefer exercises they already log, and the built-in catalog over creating new exercises. Only create an exercise when nothing suitable exists.
- To edit an existing template, call get_template first and send the complete new version to save_template with its template_id; it replaces the whole template.

# The data
- Exercises have a measurement type. external_load_reps: weight x reps, where loadConvention "total" means the full weight moved (barbell, machine, stack) and "per_hand" means the weight of one dumbbell; volume for per_hand exercises counts one hand's weight. bodyweight_reps: reps only. weighted_bodyweight_reps: the weight added to bodyweight. assisted_bodyweight_reps: the assistance weight, where lower is better.
- Two exercises with similar names are separate histories (for example a built-in "Incline Bench Press (Dumbbell)" and a custom "Incline Dumbbell Press"). Point that out if it matters to a question.
- Sets are "warmup" or "working". Only completed working sets count toward progress, records and volume.
- Templates hold exercises with rest times and target sets (a rep range, optionally a target weight). Starting a workout copies a template; editing a template never changes past workouts.
- Estimated 1RM uses the Epley formula and is only meaningful up to about 12 reps. Say "estimated" when you use it.

# Writing
- They read on a phone. Lead with the answer, keep it short, and use short lists rather than long paragraphs. Use **bold** sparingly. Don't use tables or headings above ###.
- Give real numbers with dates ("185 x 5 on Nov 12, up from 175 x 5 on Oct 3"), not vague trends.
- When you build a program, give the reasoning in a sentence or two per day, not an essay.
- Training advice should be practical and conservative: progressive overload, sensible weekly volume, recovery. You're not a doctor; for pain or injury, suggest they see one.

Once you've answered something, treat that answer as done. On later turns, focus on what they're asking now, unless they ask about an earlier answer or point out a problem with it.`

/**
 * Strict schemas (guaranteed-valid input) are worth it for the tools that change data. The
 * API caps strict schemas at 16 nullable parameters in total, so read-only tools use plain
 * optional parameters instead; the browser validates their input anyway.
 */
export const MAX_STRICT_UNIONS = 16

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const dateField = (what: string) => ({ type: 'string', description: `${what} as YYYY-MM-DD in the user's time zone. Omit for no limit.` })
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

/** A tool that changes data: strict, every field required (nullable where optional). */
const writeTool = (name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema: object(properties),
  strict: true,
})

/** A read-only tool: listed parameters are required, the rest optional. */
const readTool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema: object(properties, required),
})

export const chatTools: Anthropic.Beta.BetaTool[] = [
  readTool(
    'get_overview',
    'A summary of the account: today, weight unit, how many workouts are logged and the date range, every template (id, name, exercise count), the 10 most recent workouts, custom exercises, and the latest body weight. Call this first when you need context.',
  ),
  readTool('find_exercises', 'Search the built-in catalog and the user\'s custom exercises. Returns id, name, muscles, equipment, measurement and how many workouts they appear in. Up to 40 results, most-logged first.', {
    query: { type: 'string', description: 'Words to match in the name. Omit for all.' },
    muscle: { type: 'string', enum: [...muscleGroups], description: 'Only exercises with this primary muscle.' },
    logged_only: { type: 'boolean', description: 'true to return only exercises that appear in at least one completed workout.' },
  }),
  readTool('get_template', 'One template in full: each exercise with its name, rest, notes and target sets.', {
    template_id: { type: 'string' },
  }, ['template_id']),
  readTool('list_workouts', 'Completed workouts, newest first: id, name, date, duration, and per exercise the completed working sets as "weight x reps".', {
    from: dateField('Earliest day'),
    to: dateField('Latest day'),
    limit: { type: 'integer', description: 'At most this many workouts (default 20, max 100).' },
  }),
  readTool('get_workout', 'One workout in full, every set including warm-ups and incomplete sets, with RIR and notes.', {
    workout_id: { type: 'string' },
  }, ['workout_id']),
  readTool('exercise_progress', 'History of one exercise, one point per workout, oldest first: top set, estimated 1RM, working sets, reps and volume; plus personal records. Use for "how is my X progressing" questions.', {
    exercise_id: { type: 'string' },
    from: dateField('Earliest day'),
    to: dateField('Latest day'),
  }, ['exercise_id']),
  readTool('training_volume', 'Completed working sets per week, grouped by primary muscle (and by exercise within each muscle). Use for balance and weekly-volume questions.', {
    from: dateField('Earliest day (default 8 weeks ago)'),
    to: dateField('Latest day (default today)'),
  }),
  readTool('body_weight', 'Body-weight entries as daily averages with a 7-day rolling average.', {
    from: dateField('Earliest day'),
    to: dateField('Latest day'),
  }),
  writeTool(
    'save_template',
    'Create a template, or replace an existing one completely. The user approves it first. Weights are in the user\'s unit.',
    {
      template_id: { ...nullable({ type: 'string' }), description: 'The template to replace, or null to create a new one.' },
      name: { type: 'string' },
      notes: nullable({ type: 'string' }),
      exercises: {
        type: 'array',
        items: object({
          exercise_id: { type: 'string', description: 'An id from find_exercises.' },
          rest_seconds: { ...nullable({ type: 'integer' }), description: 'Rest after each set, or null for the default (90).' },
          notes: nullable({ type: 'string' }),
          sets: {
            type: 'array',
            items: object({
              type: { type: 'string', enum: ['warmup', 'working'] },
              reps_min: nullable({ type: 'integer' }),
              reps_max: { ...nullable({ type: 'integer' }), description: 'Same as reps_min for a fixed target.' },
              target_weight: { ...nullable({ type: 'number' }), description: 'In the user\'s unit, or null for no weight target.' },
            }),
          },
        }),
      },
    },
  ),
  writeTool('delete_template', 'Delete a template. Past workouts are kept. The user approves it first.', {
    template_id: { type: 'string' },
  }),
  writeTool('create_exercise', 'Add a custom exercise when nothing in the catalog fits. The user approves it first.', {
    name: { type: 'string' },
    primary_muscle: { type: 'string', enum: [...muscleGroups] },
    secondary_muscles: { type: 'array', items: { type: 'string', enum: [...muscleGroups] } },
    equipment: { type: 'string', enum: [...equipment] },
    measurement_type: { type: 'string', enum: ['external_load_reps', 'bodyweight_reps', 'weighted_bodyweight_reps', 'assisted_bodyweight_reps'] },
    load_convention: {
      ...nullable({ type: 'string', enum: ['total', 'per_hand'] }),
      description: 'Only for external_load_reps: "total" for the full weight, "per_hand" for one dumbbell. Null otherwise.',
    },
  }),
]
