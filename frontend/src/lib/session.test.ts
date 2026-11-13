import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/lib/axios', () => ({ default: { get } }))

import { useWorkspaceStore } from '@/store/workspaceStore'
import { expireSession, SESSION_EXPIRED_EVENT } from './session'
import { useWorkspace } from './workspace'

describe('expireSession', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url === '/projects' ? { projects: [{ id: 'p1', name: 'Shop', organizationId: 'o1' }] } : { organizations: [] },
      })
    )
  })

  it('clears token, workspace context and cache, then redirects', async () => {
    localStorage.setItem('token', 't')
    useWorkspaceStore.getState().rememberProject('p1', 'o1')
    const { result } = renderHook(() => useWorkspace())
    await waitFor(() => expect(result.current.projects).toHaveLength(1))

    const onExpired = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    const redirect = vi.fn()
    act(() => expireSession(redirect))
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)

    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('translately-workspace')).toBeNull()
    expect(useWorkspaceStore.getState()).toMatchObject({ lastProjectId: null, lastOrgId: null })
    expect(result.current.projects).toEqual([])
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

describe('browser session from before the rename (old togglely-* keys)', () => {
  const STATE = (id: string) => JSON.stringify({ state: { lastProjectId: id, lastOrgId: 'o1' }, version: 0 })

  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('does not read the old workspace key but does read the new one', async () => {
    localStorage.setItem('togglely-workspace', STATE('old'))
    let mod = await import('@/store/workspaceStore')
    expect(mod.useWorkspaceStore.getState()).toMatchObject({ lastProjectId: null, lastOrgId: null })

    vi.resetModules()
    localStorage.setItem('translately-workspace', STATE('new'))
    mod = await import('@/store/workspaceStore')
    expect(mod.useWorkspaceStore.getState().lastProjectId).toBe('new')
  })

  it('ends in a clean logged-out state without throwing, old keys removed', async () => {
    localStorage.setItem('togglely-workspace', STATE('old'))
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'old-token' }, version: 0 }))
    const session = await import('./session')
    expect(session.getSessionToken()).toBe('old-token') // the server rejects it with 401 -> expireSession

    const redirect = vi.fn()
    expect(() => session.expireSession(redirect)).not.toThrow()
    expect(session.getSessionToken()).toBeNull()
    expect(localStorage.getItem('auth-storage')).toBeNull()
    expect(localStorage.getItem('togglely-workspace')).toBeNull()
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('treats corrupt old data as logged out without throwing', async () => {
    localStorage.setItem('auth-storage', '{not json')
    localStorage.setItem('togglely-workspace', '{not json')
    const session = await import('./session')
    expect(() => session.getSessionToken()).not.toThrow()
    expect(session.getSessionToken()).toBeNull()
    const mod = await import('@/store/workspaceStore')
    expect(mod.useWorkspaceStore.getState().lastProjectId).toBeNull()
  })
})
