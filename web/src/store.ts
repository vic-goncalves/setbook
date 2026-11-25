import { useSyncExternalStore } from 'react'
import { api, type Mutation, type MutationResult, type PullPage } from './api'
import type { BodyMeasurement, Entity, EntityBody, Exercise, WorkoutSession, WorkoutTemplate } from './domain/types'
import { builtInExercises } from './domain/catalog'

/** Internally untyped by entity; `save` and `build` keep the public API typed. */
interface Item {
  revision: number
  body: EntityBody[Entity] | undefined
}

export interface Conflict {
  entity: Entity
  id: string
  reason: string
  message: string
  server: { revision: number; deleted: boolean; body: unknown } | null
}

export interface Snapshot {
  status: 'loading' | 'ready' | 'error'
  error?: string
  customExercises: Exercise[]
  templates: WorkoutTemplate[]
  sessions: WorkoutSession[]
  measurements: BodyMeasurement[]
  exerciseById: Map<string, Exercise>
  pending: number
  syncing: boolean
  lastSyncedAt?: number
  syncError?: string
  conflicts: Conflict[]
}

const PUSH_DELAY = 800
const POLL_INTERVAL = 30_000

/**
 * The signed-in user's records, mirrored from the server. Edits apply locally at once, then
 * push per record (one in flight each, so every write is based on the previous result).
 * Conflicts are kept for the user to resolve; nothing is overwritten silently.
 */
class Store {
  private records: Record<Entity, Map<string, Item>> = { exercise: new Map(), template: new Map(), session: new Map(), measurement: new Map() }
  private cursor = 0
  private dirty = new Map<string, { entity: Entity; id: string; deleted: boolean }>()
  private inFlight = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private conflicts = new Map<string, Conflict>()
  private listeners = new Set<() => void>()
  private poller?: ReturnType<typeof setInterval>
  private state: Pick<Snapshot, 'status' | 'error' | 'syncing' | 'lastSyncedAt' | 'syncError'> = { status: 'loading', syncing: false }
  private snapshot: Snapshot = this.build()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  async start() {
    this.reset()
    try {
      await this.pull()
      this.state = { ...this.state, status: 'ready', lastSyncedAt: Date.now() }
    } catch (error) {
      this.state = { ...this.state, status: 'error', error: (error as Error).message }
    }
    this.emit()
    this.poller = setInterval(() => void this.refresh(), POLL_INTERVAL)
    window.addEventListener('focus', this.onFocus)
  }

  stop() {
    clearInterval(this.poller)
    window.removeEventListener('focus', this.onFocus)
    this.timers.forEach(clearTimeout)
    this.reset()
  }

  private onFocus = () => void this.refresh()

  private reset() {
    for (const map of Object.values(this.records)) map.clear()
    this.cursor = 0
    this.dirty.clear()
    this.conflicts.clear()
    this.state = { status: 'loading', syncing: false }
    this.emit()
  }

  /** Saves a record locally and schedules its push. */
  save<E extends Entity>(entity: E, body: EntityBody[E]) {
    const map = this.records[entity]
    const existing = map.get(body.id)
    map.set(body.id, { revision: existing?.revision ?? 0, body })
    this.markDirty(entity, body.id, false)
  }

  remove(entity: Entity, id: string) {
    const map = this.records[entity]
    if (!map.has(id)) return
    map.set(id, { revision: map.get(id)?.revision ?? 0, body: undefined })
    this.markDirty(entity, id, true)
  }

  async refresh() {
    if (this.state.syncing) return
    this.state = { ...this.state, syncing: true }
    this.emit()
    try {
      await this.pull()
      this.state = { ...this.state, lastSyncedAt: Date.now(), syncError: undefined }
    } catch (error) {
      this.state = { ...this.state, syncError: (error as Error).message }
    } finally {
      this.state = { ...this.state, syncing: false }
      this.emit()
    }
  }

  resolve(conflict: Conflict, keepMine: boolean) {
    const key = `${conflict.entity}/${conflict.id}`
    this.conflicts.delete(key)
    const map = this.records[conflict.entity]
    const item = map.get(conflict.id)
    if (keepMine) {
      if (item) map.set(conflict.id, { ...item, revision: conflict.server?.revision ?? item.revision })
      this.markDirty(conflict.entity, conflict.id, item?.body === undefined)
    } else {
      this.dirty.delete(key)
      if (conflict.server) this.applyRemote(conflict.entity, conflict.id, conflict.server)
      this.emit()
    }
  }

  private markDirty(entity: Entity, id: string, deleted: boolean) {
    const key = `${entity}/${id}`
    this.dirty.set(key, { entity, id, deleted })
    clearTimeout(this.timers.get(key))
    this.timers.set(key, setTimeout(() => void this.flush(key), PUSH_DELAY))
    this.emit()
  }

  private async flush(key: string) {
    const entry = this.dirty.get(key)
    if (!entry || this.inFlight.has(key) || this.conflicts.has(key)) return
    const item = this.records[entry.entity].get(entry.id)
    const mutation: Mutation = {
      mutationId: crypto.randomUUID(),
      entity: entry.entity,
      id: entry.id,
      baseRevision: item?.revision ?? 0,
      deleted: entry.deleted,
      body: entry.deleted ? undefined : item?.body,
    }
    const sentBody = item?.body
    this.dirty.delete(key)
    this.inFlight.add(key)
    this.state = { ...this.state, syncing: true }
    this.emit()
    try {
      let result: MutationResult | undefined
      // Retry the same mutation ID on network failure; the server de-duplicates it.
      for (let attempt = 0; attempt < 5 && !result; attempt++) {
        try {
          result = (await api<{ results: MutationResult[] }>('POST', '/v1/sync/push', { mutations: [mutation] })).results[0]
        } catch (error) {
          if (attempt === 4) throw error
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
        }
      }
      if (!result) return
      const current = this.records[entry.entity].get(entry.id)
      if (result.status === 'applied') {
        if (current) this.records[entry.entity].set(entry.id, { ...current, revision: result.revision })
        if (entry.deleted) this.records[entry.entity].delete(entry.id)
        this.state = { ...this.state, lastSyncedAt: Date.now(), syncError: undefined }
      } else if (result.status === 'conflict') {
        this.conflicts.set(key, { entity: entry.entity, id: entry.id, reason: result.reason, server: result.current,
          message: result.reason === 'active_exists' ? 'A workout is already in progress on another device.' : 'This changed on another device.' })
        if (!this.dirty.has(key)) this.dirty.set(key, entry)
      } else {
        this.conflicts.set(key, { entity: entry.entity, id: entry.id, reason: 'rejected', server: null, message: result.error.message })
      }
      // Edits made while this push was in flight go next, based on the new revision.
      if (current && current.body !== sentBody && !this.dirty.has(key) && result.status === 'applied') {
        this.dirty.set(key, { ...entry, deleted: current.body === undefined })
      }
    } catch (error) {
      this.dirty.set(key, entry)
      this.state = { ...this.state, syncError: `Couldn't sync: ${(error as Error).message}` }
    } finally {
      this.inFlight.delete(key)
      this.state = { ...this.state, syncing: this.inFlight.size > 0 }
      this.emit()
      if (this.dirty.has(key) && !this.conflicts.has(key)) {
        this.timers.set(key, setTimeout(() => void this.flush(key), PUSH_DELAY))
      }
    }
  }

  private async pull() {
    let more = true
    while (more) {
      const page = await api<PullPage>('GET', `/v1/sync/pull?cursor=${this.cursor}`)
      for (const change of page.changes) {
        const key = `${change.entity}/${change.id}`
        if (this.dirty.has(key) || this.inFlight.has(key) || this.conflicts.has(key)) continue
        const local = this.records[change.entity].get(change.id)
        if (local && local.revision >= change.revision) continue
        this.applyRemote(change.entity, change.id, change)
      }
      this.cursor = page.cursor
      more = page.hasMore
    }
    this.emit()
  }

  private applyRemote(entity: Entity, id: string, record: { revision: number; deleted: boolean; body: unknown }) {
    if (record.deleted || !record.body) this.records[entity].delete(id)
    else this.records[entity].set(id, { revision: record.revision, body: record.body as EntityBody[Entity] })
  }

  private emit() {
    this.snapshot = this.build()
    this.listeners.forEach((l) => l())
  }

  private build(): Snapshot {
    const live = <E extends Entity>(e: E) => [...this.records[e].values()].map((i) => i.body).filter(Boolean) as EntityBody[E][]
    const customExercises = live('exercise')
    const exerciseById = new Map<string, Exercise>()
    for (const e of [...builtInExercises, ...customExercises]) exerciseById.set(e.id.toUpperCase(), e)
    return {
      ...this.state,
      customExercises,
      templates: live('template').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      sessions: live('session').sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      measurements: live('measurement').sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)),
      exerciseById,
      pending: this.dirty.size + this.inFlight.size,
      conflicts: [...this.conflicts.values()],
    }
  }
}

export const store = new Store()

export function useStore(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
