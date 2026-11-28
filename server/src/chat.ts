import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import { z } from 'zod'
import { parse } from './auth'
import type { AppBindings, Env } from './env'
import { HttpError } from './errors'
import { chatSystemPrompt, chatTools } from './chat-prompt'

/**
 * One model turn for the in-app coach. The browser runs the conversation: it keeps the
 * history, runs the tools against the data it already holds, and calls this once per turn.
 * The server only holds the API key and fixes everything else about the request (model,
 * system prompt, tools, limits), so the key can't be used for anything but this chat.
 *
 * The response is newline-delimited JSON: the model's raw stream events as they arrive, then
 * one `{ type: "final", message }` with the complete message (thinking blocks included, which
 * the browser must send back unchanged), or `{ type: "error", error }` if the turn failed.
 */

export const DEFAULT_CHAT_MODEL = 'claude-haiku-5-5'
// Bounds the worst case per call; low effort keeps real replies far below it.
const MAX_TOKENS = 8000
const MAX_MESSAGES = 200
// Haiku 5.5 prices prompts over 100K tokens at 5x. Well below that, the app starts a new chat.
const MAX_BODY_BYTES = 280_000

// Roles only; content is checked by the API. `system` can't be smuggled in from the browser.
const requestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string(), z.array(z.unknown())]) }))
    .min(1)
    .max(MAX_MESSAGES),
})

let fetchForTesting: typeof fetch | undefined
/** Tests replace the network call to Anthropic. */
export function setChatFetchForTesting(f: typeof fetch | undefined) {
  fetchForTesting = f
}

function client(env: Env) {
  // Explicit base URL and key: with nodejs_compat, process.env can carry other ANTHROPIC_* values.
  // Local development (DEV_AUTH) may point at a stand-in API.
  const baseURL = env.DEV_AUTH === 'true' && env.ANTHROPIC_BASE_URL ? env.ANTHROPIC_BASE_URL : 'https://api.anthropic.com'
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, authToken: null, baseURL, maxRetries: 2, ...(fetchForTesting ? { fetch: fetchForTesting } : {}) })
}

export const chat = new Hono<AppBindings>()

chat.post('/', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'chat_not_configured', "Chat isn't set up on the server yet. Add the ANTHROPIC_API_KEY secret to the Worker.")
  const raw = await c.req.text()
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'conversation_too_long', 'This conversation is too long. Start a new chat.')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid_request', 'Request body must be JSON.')
  }
  const { messages } = parse(requestSchema, body)
  if (messages[0]!.role !== 'user') throw new HttpError(400, 'invalid_request', 'A conversation starts with a user message.')

  const model = c.env.CHAT_MODEL || DEFAULT_CHAT_MODEL
  // Server-side fallback (retry a safety decline on another model) exists for Sonnet, Opus
  // and Fable; Haiku has none, and a request that asks for it fails.
  const fallback = !model.startsWith('claude-haiku')
  const stream = client(c.env).beta.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    // Keep thinking blocks that no longer match (e.g. after a system prompt change in a
    // deploy) from failing old conversations: they're dropped instead.
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    // Lowest thinking level: thinking is billed as output, and the context the app sends
    // usually has the answer already.
    output_config: { effort: 'low' },
    // Caches the system prompt, tools and history so far; each turn re-reads it cheaply.
    cache_control: { type: 'ephemeral' },
    system: chatSystemPrompt,
    tools: chatTools,
    messages: messages as Anthropic.Beta.BetaMessageParam[],
    betas: ['thinking-binding-controls-2026-08-01', ...(fallback ? (['server-side-fallback-2026-07-01'] as const) : [])],
    ...(fallback ? { fallbacks: 'default' as const } : {}),
  })

  const encoder = new TextEncoder()
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`)
  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) controller.enqueue(line(event))
        const message = await stream.finalMessage()
        // Token usage per turn, for cost checks in the Worker's logs (wrangler tail / dashboard).
        console.log(JSON.stringify({ chatTurn: { model: message.model, stop: message.stop_reason, usage: message.usage } }))
        controller.enqueue(line({ type: 'final', message }))
      } catch (error) {
        controller.enqueue(line({ type: 'error', error: describe(error) }))
      } finally {
        controller.close()
      }
    },
    cancel() {
      stream.abort()
    },
  })
  return new Response(output, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } })
})

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof Anthropic.AuthenticationError) return { code: 'chat_key_invalid', message: "The server's Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret." }
  if (error instanceof Anthropic.PermissionDeniedError) return { code: 'chat_forbidden', message: "The server's Anthropic API key can't use this model." }
  if (error instanceof Anthropic.RateLimitError) return { code: 'chat_rate_limited', message: 'Claude is busy or your API spending limit was reached. Try again in a minute.' }
  if (error instanceof Anthropic.BadRequestError) return { code: 'chat_bad_request', message: `Claude couldn't read this conversation: ${error.message}` }
  if (error instanceof Anthropic.APIError) return { code: 'chat_unavailable', message: `Claude is unavailable right now (${error.status ?? 'network'}). Try again.` }
  console.error('Chat stream failed', error)
  return { code: 'chat_failed', message: 'Something went wrong talking to Claude. Try again.' }
}
