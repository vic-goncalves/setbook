import { useSyncExternalStore } from 'react'
import { ApiError, api, apiStream, currentUser } from '../api'
import { localTimeZone, newId } from '../domain/types'
import { currentPrefs } from '../prefs'
import { runTool, serialize, toolActivity, type Proposal } from './tools'

/**
 * The coach conversation. The browser owns the history and sends all of it each turn; the
 * server adds the instructions and tools and streams Claude's reply. Tool calls run here.
 *
 * History is append-only and assistant content is stored exactly as the API returned it
 * (thinking blocks included): the API checks earlier turns are unchanged.
 *
 * Each conversation is saved to the account after every turn (PUT /v1/chats/:id), so it can be
 * reopened and continued on any device. The open one is also kept on this device, so it
 * shows instantly and survives being offline.
 */

export type Block = { type: string; [key: string]: unknown }
export interface Message {
  role: 'user' | 'assistant'
  content: Block[]
}

export interface PendingApproval extends Omit<Proposal, 'apply'> {
  toolUseId: string
}

export interface ChatState {
  /** This conversation's id on the server. */
  id: string
  messages: Message[]
  busy: boolean
  /** Text of the reply being streamed. */
  live: string
  /** What's happening right now, e.g. "Checking your progress". */
  activity?: string
  pending?: PendingApproval
  error?: string
  /** Outcome of each write, by tool_use id, for the cards in the transcript. */
  decisions: Record<string, 'approved' | 'declined' | 'failed'>
}

const MAX_ROUNDS = 15
const STORAGE_PREFIX = 'setbook.chat.'

const listeners = new Set<() => void>()
let state: ChatState = load()
let controller: AbortController | undefined
let approve: ((ok: boolean) => void) | undefined

function key() {
  return `${STORAGE_PREFIX}${currentUser()?.id ?? 'anon'}`
}

function blank(): ChatState {
  return { id: newId(), messages: [], busy: false, live: '', decisions: {} }
}

function load(): ChatState {
  try {
    const saved = JSON.parse(localStorage.getItem(key()) ?? 'null') as Partial<Pick<ChatState, 'id' | 'messages' | 'decisions'>> | null
    // Chats saved before history existed have no id: they get one and are uploaded on the next turn.
    return saved ? { ...blank(), id: saved.id ?? newId(), messages: saved.messages ?? [], decisions: saved.decisions ?? {} } : blank()
  } catch {
    return blank()
  }
}

function save() {
  try {
    localStorage.setItem(key(), JSON.stringify({ id: state.id, messages: state.messages, decisions: state.decisions }))
  } catch {
    // Storage full or unavailable: the chat still works, it just won't survive a reload.
  }
}

/** The first thing the user asked, as the chat's name in the history list. */
export function chatTitle(messages: Message[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue
    const text = m.content.find((b) => b.type === 'text' && !isContextBlock(b))?.text
    if (typeof text === 'string' && text.trim()) {
      const line = text.trim().replace(/\s+/g, ' ')
      return line.length > 80 ? `${line.slice(0, 79)}…` : line
    }
  }
  return 'New chat'
}

let uploading: Promise<void> | undefined
let uploadAgain = false

/** Saves the open conversation to the account. Failures are kept quiet and retried next turn. */
function upload() {
  if (state.messages.length === 0) return
  if (uploading) {
    uploadAgain = true
    return
  }
  const { id, messages, decisions } = state
  uploading = api('PUT', `/v1/chats/${id}`, { title: chatTitle(messages), messages, decisions })
    .then(() => undefined, () => undefined)
    .finally(() => {
      uploading = undefined
      if (uploadAgain) {
        uploadAgain = false
        upload()
      }
    })
}

export interface ChatSummary {
  id: string
  title: string
  updatedAt: string
}

export async function listChats(): Promise<ChatSummary[]> {
  return (await api<{ chats: ChatSummary[] }>('GET', '/v1/chats')).chats
}

/** Opens a saved conversation to read or continue. */
export async function openChat(id: string) {
  if (state.busy) return
  const chat = await api<{ id: string; messages: Message[]; decisions: ChatState['decisions'] }>('GET', `/v1/chats/${id}`)
  state = { ...blank(), id: chat.id, messages: chat.messages, decisions: chat.decisions ?? {} }
  save()
  listeners.forEach((l) => l())
}

export async function deleteChat(id: string) {
  await api('DELETE', `/v1/chats/${id}`)
  if (id === state.id) newChat()
}

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function append(message: Message) {
  set({ messages: [...state.messages, message] })
  save()
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Reloads the saved conversation, e.g. after a different account signs in. */
export function reloadChat() {
  stop()
  state = load()
  listeners.forEach((l) => l())
}

/** Starts a fresh conversation. The current one stays in the history. */
export function newChat() {
  stop()
  upload()
  try {
    localStorage.removeItem(key())
  } catch {
    // ignore
  }
  state = blank()
  listeners.forEach((l) => l())
}

export function stop() {
  controller?.abort()
  approve?.(false)
}

export function decide(ok: boolean) {
  approve?.(ok)
}

function context(): string {
  const now = new Date()
  const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return `<context>\nToday: ${date}\nTime zone: ${localTimeZone()}\nWeight unit: ${currentPrefs().unit}\n</context>`
}

export function isContextBlock(block: Block) {
  return block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('<context>')
}

export async function send(text: string) {
  const trimmed = text.trim()
  if (!trimmed || state.busy) return
  const content: Block[] = []
  // If the last turn ended mid-tool (the app closed, or a stop), answer those calls first:
  // every tool_use needs a tool_result before the conversation can go on.
  const last = state.messages.at(-1)
  if (last?.role === 'assistant') {
    for (const b of last.content.filter((b) => b.type === 'tool_use')) {
      content.push({ type: 'tool_result', tool_use_id: b.id, content: 'Not run: the user stopped this before it finished.', is_error: true })
    }
  }
  if (state.messages.length === 0) content.push({ type: 'text', text: context() })
  content.push({ type: 'text', text: trimmed })
  append({ role: 'user', content })
  await run()
}

/** Runs the last turn again after an error (the last message is still the user's). */
export async function retry() {
  if (state.busy || state.messages.at(-1)?.role !== 'user') return
  await run()
}

async function run() {
  controller = new AbortController()
  set({ busy: true, error: undefined, live: '', activity: 'Thinking' })
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const message = await turn(controller.signal)
      append({ role: 'assistant', content: message.content })
      set({ live: '' })
      if (message.stop_reason === 'refusal') {
        set({ error: "Claude declined to answer that one. Try asking differently." })
        return
      }
      const calls = message.content.filter((b) => b.type === 'tool_use')
      if (message.stop_reason === 'max_tokens') {
        if (calls.length) set({ error: 'That reply got cut off. Try asking for less at once.' })
        return
      }
      if (message.stop_reason !== 'tool_use' || calls.length === 0) return
      append({ role: 'user', content: await runCalls(calls) })
      set({ activity: 'Thinking' })
    }
    set({ error: `Stopped after ${MAX_ROUNDS} steps. Ask again to continue.` })
  } catch (error) {
    if ((error as Error).name === 'AbortError') return
    set({ error: error instanceof ApiError ? error.message : `Couldn't reach Claude: ${(error as Error).message}` })
  } finally {
    controller = undefined
    set({ busy: false, live: '', activity: undefined, pending: undefined })
    upload()
  }
}

/** All results go back in one user message, in call order. */
async function runCalls(calls: Block[]): Promise<Block[]> {
  const results: Block[] = []
  for (const call of calls) {
    const name = String(call.name)
    set({ activity: toolActivity[name] ?? 'Working' })
    const outcome = runTool(name, call.input)
    if (outcome.kind === 'result') {
      results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.content })
    } else if (outcome.kind === 'error') {
      results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.content, is_error: true })
    } else {
      results.push(await askApproval(String(call.id), outcome))
    }
  }
  return results
}

async function askApproval(toolUseId: string, proposal: Proposal): Promise<Block> {
  const { apply, ...shown } = proposal
  set({ pending: { ...shown, toolUseId }, activity: 'Waiting for your approval' })
  const ok = await new Promise<boolean>((resolve) => {
    approve = resolve
  })
  approve = undefined
  set({ pending: undefined })
  if (!ok) {
    record(toolUseId, 'declined')
    return { type: 'tool_result', tool_use_id: toolUseId, content: 'The user declined this change. Nothing was saved. Ask what they would like instead.', is_error: true }
  }
  try {
    const result = apply()
    record(toolUseId, 'approved')
    return { type: 'tool_result', tool_use_id: toolUseId, content: serialize(result) }
  } catch (error) {
    record(toolUseId, 'failed')
    return { type: 'tool_result', tool_use_id: toolUseId, content: `Saving failed: ${(error as Error).message}`, is_error: true }
  }
}

function record(toolUseId: string, decision: ChatState['decisions'][string]) {
  set({ decisions: { ...state.decisions, [toolUseId]: decision } })
  save()
}

interface FinalMessage {
  content: Block[]
  stop_reason: string | null
}

/** One model turn: streams text into `live` and resolves with the complete message. */
async function turn(signal: AbortSignal): Promise<FinalMessage> {
  const body = await apiStream('/v1/chat', { messages: state.messages }, signal)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let live = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = done ? '' : lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as { type: string; [key: string]: any }
      if (event.type === 'final') return event.message as FinalMessage
      if (event.type === 'error') throw new ApiError(502, event.error?.code ?? 'chat_failed', event.error?.message ?? 'Something went wrong talking to Claude.')
      if (event.type === 'content_block_start' && event.content_block?.type === 'text' && live) {
        live += '\n\n'
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        live += event.delta.text
        set({ live, activity: undefined })
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        set({ activity: toolActivity[event.content_block.name] ?? 'Working' })
      }
    }
    if (done) break
  }
  throw new ApiError(502, 'chat_incomplete', 'The reply was cut off. Try again.')
}
