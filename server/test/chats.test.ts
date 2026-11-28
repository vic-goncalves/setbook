import { describe, expect, it } from 'vitest'
import { previewOf } from '../src/chats'
import { call, devLogin, json, uuid } from './helpers'

const conversation = (text: string) => ({
  title: text,
  messages: [
    { role: 'user', content: [{ type: 'text', text }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Answer' }] },
  ],
  decisions: { toolu_1: 'approved' },
})

function put(token: string, id: string, body: unknown) {
  return call(`/v1/chats/${id}`, { method: 'PUT', token, body: JSON.stringify(body) })
}

describe('chat previews', () => {
  it('uses the latest reply as plain text, shortened', () => {
    const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] })
    expect(previewOf([{ role: 'user', content: [] }])).toBe('')
    expect(previewOf([reply('Old'), { role: 'user', content: [] }, reply('Your **bench** is up:\n- 185 x 5')])).toBe('Your bench is up: 185 x 5')
    expect(previewOf([reply('a'.repeat(300))])).toHaveLength(140)
  })
})

describe('saved chats', () => {
  it('saves, lists newest first, reopens exactly and deletes', async () => {
    const { accessToken: token } = await devLogin('chats-crud')
    const a = uuid()
    const b = uuid()
    expect((await put(token, a, conversation('First'))).status).toBe(200)
    expect((await put(token, b, conversation('Second'))).status).toBe(200)
    expect((await put(token, a, { ...conversation('First, renamed') })).status).toBe(200)

    const list = await json(await call('/v1/chats', { token }))
    expect(list.chats.map((c: { title: string }) => c.title)).toEqual(['First, renamed', 'Second'])
    expect(list.chats[0].preview).toBe('Answer')

    const opened = await json(await call(`/v1/chats/${a.toLowerCase()}`, { token }))
    expect(opened.messages).toEqual(conversation('x').messages.map((m, i) => (i === 0 ? { ...m, content: [{ type: 'text', text: 'First, renamed' }] } : m)))
    expect(opened.decisions).toEqual({ toolu_1: 'approved' })

    expect((await call(`/v1/chats/${a}`, { method: 'DELETE', token })).status).toBe(204)
    expect((await call(`/v1/chats/${a}`, { token })).status).toBe(404)
  })

  it("keeps each person's chats to themselves", async () => {
    const owner = await devLogin('chats-owner')
    const other = await devLogin('chats-other')
    const id = uuid()
    await put(owner.accessToken, id, conversation('Private'))
    expect((await call(`/v1/chats/${id}`, { token: other.accessToken })).status).toBe(404)
    expect((await json(await call('/v1/chats', { token: other.accessToken }))).chats).toEqual([])
    await call(`/v1/chats/${id}`, { method: 'DELETE', token: other.accessToken })
    expect((await call(`/v1/chats/${id}`, { token: owner.accessToken })).status).toBe(200)
  })

  it('lets the web app save from its own origin (CORS allows PUT)', async () => {
    const response = await call(`/v1/chats/${uuid()}`, {
      method: 'OPTIONS',
      headers: { origin: 'https://web.test', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' },
    })
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT')
  })

  it('rejects bad ids, bad shapes and oversized chats', async () => {
    const { accessToken: token } = await devLogin('chats-invalid')
    expect((await put(token, 'not-a-uuid', conversation('x'))).status).toBe(400)
    expect((await put(token, uuid(), { title: '', messages: [] })).status).toBe(400)
    expect((await put(token, uuid(), { title: 'x', messages: [{ role: 'system', content: [] }] })).status).toBe(400)
    const huge = conversation('x')
    huge.messages[1]!.content.push({ type: 'text', text: 'a'.repeat(950_000) })
    expect((await put(token, uuid(), huge)).status).toBe(413)
  })

  it('goes with the account when it is deleted', async () => {
    const { accessToken: token } = await devLogin('chats-delete-account')
    await put(token, uuid(), conversation('Gone soon'))
    expect((await call('/v1/me', { method: 'DELETE', token })).status).toBe(204)
    const again = await devLogin('chats-delete-account')
    expect((await json(await call('/v1/chats', { token: again.accessToken }))).chats).toEqual([])
  })
})
