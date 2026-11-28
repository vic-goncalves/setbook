import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { decide, isContextBlock, newChat, retry, send, stop, useChat, type Block, type Message } from '../chat/conversation'
import { Markdown } from '../chat/markdown'
import { toolActivity } from '../chat/tools'
import { useStore, type Snapshot } from '../store'
import { PageHeader } from '../ui/components'
import { Icon } from '../ui/icons'

const WRITE_TOOLS = new Set(['save_template', 'delete_template', 'create_exercise'])

/** Past-tense labels for finished steps. */
const toolDone: Record<string, string> = {
  get_overview: 'Looked at your account',
  find_exercises: 'Searched exercises',
  get_template: 'Read a template',
  list_workouts: 'Looked at your workouts',
  get_workout: 'Read a workout',
  exercise_progress: 'Checked your progress',
  training_volume: 'Added up weekly volume',
  body_weight: 'Looked at body weight',
}

type IconName = Parameters<typeof Icon>[0]['name']

/** Suggestions built from the user's own data, so the first tap is relevant. */
function suggestions(data: Snapshot): { icon: IconName; text: string }[] {
  const counts = new Map<string, number>()
  for (const s of data.sessions.filter((x) => x.state === 'completed')) {
    for (const e of s.exercises) counts.set(e.exerciseId.toUpperCase(), (counts.get(e.exerciseId.toUpperCase()) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const name = top ? data.exerciseById.get(top[0])?.name.replace(/\s*\(.*\)\s*$/, '').toLowerCase() : undefined
  const hasWorkouts = counts.size > 0
  return [
    { icon: 'chart', text: name ? `How is my ${name} trending?` : 'How should I track my progress?' },
    { icon: 'dumbbell', text: hasWorkouts ? 'What should I train today?' : 'Build me a beginner full-body plan' },
    { icon: 'calendar', text: hasWorkouts ? 'Which muscles am I neglecting?' : 'How many days a week should I lift?' },
    { icon: 'sparkle', text: 'Build me a 45-minute pull day' },
  ]
}

export function Coach() {
  const chat = useChat()
  const data = useStore()
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const empty = chat.messages.length === 0 && !chat.busy
  const ideas = useMemo(() => suggestions(data), [data])

  // Results of each tool call, by tool_use id, so finished writes can link to what they made.
  const results = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    for (const m of chat.messages) {
      if (m.role !== 'user') continue
      for (const b of m.content) {
        if (b.type !== 'tool_result' || b.is_error || typeof b.content !== 'string') continue
        try {
          map.set(String(b.tool_use_id), JSON.parse(b.content))
        } catch {
          // Not JSON: nothing to link to.
        }
      }
    }
    return map
  }, [chat.messages])

  // Follow the conversation as it grows, like a messaging app.
  useEffect(() => {
    if (!empty) end.current?.scrollIntoView({ block: 'end', behavior: chat.live ? 'auto' : 'smooth' })
  }, [empty, chat.messages.length, chat.live, chat.activity, chat.pending, chat.error])

  // Grow the text field with its content, up to about five lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [draft])

  // While typing, the keyboard takes the tab bar's place (as in Messages), so hide the tab
  // bar and give the conversation the room.
  useEffect(() => {
    const root = document.documentElement
    const el = input.current
    const on = () => root.classList.add('composing')
    const off = () => root.classList.remove('composing')
    el?.addEventListener('focus', on)
    el?.addEventListener('blur', off)
    return () => {
      el?.removeEventListener('focus', on)
      el?.removeEventListener('blur', off)
      off()
    }
  }, [])

  const submit = (text = draft) => {
    if (!text.trim() || chat.busy) return
    setDraft('')
    void send(text)
  }

  return (
    <div className={`coach${empty ? ' is-empty' : ''}`}>
      <PageHeader
        account
        title="Coach"
        action={!empty && (
          <button className="icon-button coach-new" onClick={newChat} disabled={chat.busy} aria-label="New chat">
            <Icon name="compose" size={21} />
          </button>
        )}
      />

      {empty ? (
        <div className="coach-empty">
          <div className="coach-hero">
            <span className="coach-hero-mark"><Icon name="sparkle" size={26} stroke={1.8} /></span>
            <h2>What are we working on?</h2>
            <p>Answers come from your own workouts. Changes to your data always wait for your OK.</p>
          </div>
          <div className="coach-ideas" role="list" aria-label="Suggestions">
            {ideas.map((s) => (
              <button key={s.text} role="listitem" className="coach-idea" onClick={() => submit(s.text)}>
                <span className="coach-idea-icon"><Icon name={s.icon} size={17} /></span>
                <span className="spacer">{s.text}</span>
                <span className="coach-idea-go"><Icon name="up" size={15} stroke={2.2} /></span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="coach-thread" aria-live="polite">
          {chat.messages.map((m, i) => <Turn key={i} message={m} decisions={chat.decisions} results={results} />)}
          {chat.live && <div className="coach-reply streaming"><Markdown text={chat.live} /></div>}
          {chat.pending && (
            <div className={`coach-approval${chat.pending.danger ? ' danger' : ''}`} role="group" aria-label="Approve change">
              <div className="coach-approval-head">
                <span className="coach-approval-mark"><Icon name={chat.pending.danger ? 'trash' : 'check'} size={14} stroke={2.4} /></span>
                Needs your OK
              </div>
              <strong className="coach-approval-title">{chat.pending.title}</strong>
              <ApprovalLines lines={chat.pending.lines} />
              <div className="coach-approval-actions">
                <button className="btn coach-decline" onClick={() => decide(false)}>Not now</button>
                <button className="btn coach-approve" onClick={() => decide(true)}>{chat.pending.confirm}</button>
              </div>
            </div>
          )}
          {chat.activity && !chat.pending && !chat.live && (
            <div className="coach-activity"><span className="coach-dots" aria-hidden="true"><i /><i /><i /></span><span className="coach-shimmer">{chat.activity}</span></div>
          )}
          {chat.error && (
            <div className="coach-error" role="alert">
              <span className="spacer">{chat.error}</span>
              {!chat.busy && <button className="btn coach-retry" onClick={() => void retry()}><Icon name="repeat" size={15} />Retry</button>}
            </div>
          )}
          <div ref={end} />
        </div>
      )}

      <form className="coach-composer" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="coach-field">
          <textarea
            ref={input}
            rows={1}
            placeholder="Ask your coach"
            aria-label="Message"
            enterKeyHint="send"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {chat.busy ? (
            <button type="button" className="coach-send stop" onClick={stop} aria-label="Stop"><span /></button>
          ) : (
            <button type="submit" className="coach-send" disabled={!draft.trim()} aria-label="Send"><Icon name="up" size={18} stroke={2.6} /></button>
          )}
        </div>
      </form>
    </div>
  )
}

/** "Name: 3 x 6-10" lines become name/detail rows; a line without a colon is the summary. */
function ApprovalLines({ lines }: { lines: string[] }) {
  return (
    <div className="coach-approval-lines">
      {lines.map((line, i) => {
        const at = line.indexOf(': ')
        if (at === -1) return <div key={i} className="coach-approval-note">{line}</div>
        return (
          <div key={i} className="coach-approval-row">
            <span className="spacer">{line.slice(0, at)}</span>
            <span className="num coach-approval-detail">{line.slice(at + 2).replaceAll(' x ', ' × ')}</span>
          </div>
        )
      })}
    </div>
  )
}

function Turn({ message, decisions, results }: { message: Message; decisions: Record<string, string>; results: Map<string, Record<string, unknown>> }) {
  if (message.role === 'user') {
    const text = message.content.filter((b) => b.type === 'text' && !isContextBlock(b)).map((b) => String(b.text)).join('\n')
    return text ? <div className="coach-user">{text}</div> : null
  }
  // Consecutive read steps collapse into one quiet line; text and writes show as they are.
  const parts: ({ kind: 'steps'; names: string[] } | { kind: 'block'; block: Block })[] = []
  for (const block of message.content) {
    const readStep = block.type === 'tool_use' && !WRITE_TOOLS.has(String(block.name))
    const last = parts.at(-1)
    if (readStep && last?.kind === 'steps') last.names.push(String(block.name))
    else if (readStep) parts.push({ kind: 'steps', names: [String(block.name)] })
    else parts.push({ kind: 'block', block })
  }
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'steps'
          ? <Steps key={i} names={p.names} />
          : <AssistantBlock key={i} block={p.block} decisions={decisions} results={results} />,
      )}
    </>
  )
}

function Steps({ names }: { names: string[] }) {
  const labels = [...new Set(names.map((n) => toolDone[n] ?? toolActivity[n] ?? n))]
  return (
    <div className="coach-steps">
      <Icon name="check" size={13} stroke={2.6} />
      <span>{labels.join(' · ')}</span>
    </div>
  )
}

function AssistantBlock({ block, decisions, results }: { block: Block; decisions: Record<string, string>; results: Map<string, Record<string, unknown>> }) {
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
    return <div className="coach-reply"><Markdown text={block.text} /></div>
  }
  if (block.type !== 'tool_use') return null
  const name = String(block.name)
  const decision = decisions[String(block.id)]
  if (!decision) return null
  const input = block.input as { name?: string }
  const what = name === 'delete_template' ? 'Template deleted' : name === 'create_exercise' ? `Added “${input.name ?? 'exercise'}”` : `Saved “${input.name ?? 'template'}”`
  if (decision !== 'approved') {
    return <div className="coach-outcome muted"><Icon name="close" size={14} stroke={2.4} />{decision === 'declined' ? 'You said not now' : "Couldn't save that change"}</div>
  }
  const templateId = name === 'save_template' ? results.get(String(block.id))?.template_id : undefined
  return (
    <div className="coach-outcome">
      <span className="coach-outcome-mark"><Icon name="check" size={12} stroke={3} /></span>
      <span className="spacer">{what}</span>
      {typeof templateId === 'string' && <a className="coach-outcome-link" href={`#/templates/${templateId}`}>Open<Icon name="chevron" size={14} /></a>}
    </div>
  )
}
