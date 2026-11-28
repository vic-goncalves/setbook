import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { decide, isContextBlock, newChat, send, stop, useChat, type Block, type Message } from '../chat/conversation'
import { Markdown } from '../chat/markdown'
import { toolActivity } from '../chat/tools'
import { useStore } from '../store'
import { PageHeader } from '../ui/components'
import { Icon } from '../ui/icons'

const STARTERS = [
  'How is my bench press progressing?',
  'Which muscles am I training least?',
  'Summarize my last two weeks of training',
  'Build me a 45-minute pull day',
]

const WRITE_TOOLS = new Set(['save_template', 'delete_template', 'create_exercise'])

export function Coach() {
  const chat = useChat()
  const data = useStore()
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const empty = chat.messages.length === 0 && !chat.busy

  // Follow the conversation as it grows, like a messaging app.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: chat.live ? 'auto' : 'smooth' })
  }, [chat.messages.length, chat.live, chat.activity, chat.pending, chat.error])

  // Grow the text field with its content, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  const submit = (text = draft) => {
    if (!text.trim() || chat.busy) return
    setDraft('')
    void send(text)
  }

  return (
    <div className="coach">
      <PageHeader
        account
        eyebrow="Powered by Claude"
        title="Coach"
        action={!empty && <button className="btn btn-ghost" onClick={newChat} disabled={chat.busy}>New chat</button>}
      />

      {empty ? (
        <div className="coach-empty">
          <p className="subtle" style={{ lineHeight: 1.5, margin: '8px 0 20px' }}>
            Ask about your training. Claude reads your workouts, templates and body weight, and can build or edit templates for you. Nothing changes without your approval.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {STARTERS.map((s) => (
              <button key={s} className="card clickable coach-starter" onClick={() => submit(s)}>
                <span className="spacer">{s}</span>
                <Icon name="up" size={16} />
              </button>
            ))}
          </div>
          {data.sessions.length === 0 && <p className="subtle small" style={{ marginTop: 16 }}>Tip: log a few workouts first so there's something to analyze.</p>}
        </div>
      ) : (
        <div className="coach-thread" aria-live="polite">
          {chat.messages.map((m, i) => <Turn key={i} message={m} decisions={chat.decisions} />)}
          {chat.live && <div className="coach-reply"><Markdown text={chat.live} /></div>}
          {chat.pending && (
            <div className="card coach-approval" role="group" aria-label="Approve change">
              <div className="eyebrow">Approve change</div>
              <strong style={{ display: 'block', margin: '6px 0 8px', fontSize: 17 }}>{chat.pending.title}</strong>
              <ul className="coach-lines">{chat.pending.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn-secondary" onClick={() => decide(false)}>Decline</button>
                <button className="btn btn-secondary" style={{ background: chat.pending.danger ? 'var(--danger)' : 'var(--ink)', color: 'var(--bg)', border: 0 }} onClick={() => decide(true)}>
                  {chat.pending.confirm}
                </button>
              </div>
            </div>
          )}
          {chat.activity && !chat.pending && <div className="coach-activity"><span className="coach-dots" aria-hidden="true"><i /><i /><i /></span>{chat.activity}</div>}
          {chat.error && <div className="banner warn" role="alert">{chat.error}</div>}
          <div ref={end} />
        </div>
      )}

      <form className="coach-composer" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <textarea
          ref={input}
          className="input"
          rows={1}
          placeholder="Ask about your training"
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {chat.busy ? (
          <button type="button" className="coach-send" onClick={stop} aria-label="Stop"><span className="coach-stop" /></button>
        ) : (
          <button type="submit" className="coach-send" disabled={!draft.trim()} aria-label="Send"><Icon name="up" size={20} stroke={2.4} /></button>
        )}
      </form>
    </div>
  )
}

function Turn({ message, decisions }: { message: Message; decisions: Record<string, string> }) {
  if (message.role === 'user') {
    const text = message.content.filter((b) => b.type === 'text' && !isContextBlock(b)).map((b) => String(b.text)).join('\n')
    return text ? <div className="coach-user">{text}</div> : null
  }
  return (
    <>
      {message.content.map((block, i) => <AssistantBlock key={i} block={block} decisions={decisions} />)}
    </>
  )
}

function AssistantBlock({ block, decisions }: { block: Block; decisions: Record<string, string> }) {
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
    return <div className="coach-reply"><Markdown text={block.text} /></div>
  }
  if (block.type === 'tool_use') {
    const name = String(block.name)
    const decision = decisions[String(block.id)]
    if (WRITE_TOOLS.has(name) && decision) {
      const input = block.input as { name?: string }
      const what = name === 'delete_template' ? 'Deleted a template' : name === 'create_exercise' ? `Added exercise "${input.name ?? ''}"` : `Saved template "${input.name ?? ''}"`
      const text = decision === 'approved' ? what : decision === 'declined' ? `You declined: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : `Couldn't save: ${what.charAt(0).toLowerCase()}${what.slice(1)}`
      return <div className={`coach-tool ${decision}`}><Icon name={decision === 'approved' ? 'check' : 'close'} size={14} stroke={2.4} />{text}</div>
    }
    return <div className="coach-tool">{toolActivity[name] ?? name}</div>
  }
  return null
}
