import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useAuthStore } from '@/store/authStore'

const ORG_ID = 'org-1'
const FULL = `tk_${'a'.repeat(60)}beef`

const state = vi.hoisted(() => ({
  role: 'ADMIN',
  projects: [
    {
      id: 'p1',
      name: 'Shop',
      key: 'shop',
      type: 'SINGLE',
      organizationId: 'org-1',
    },
    {
      id: 'p2',
      name: 'Blog',
      key: 'blog',
      type: 'SINGLE',
      organizationId: 'org-1',
    },
  ] as unknown[],
  keys: [] as unknown[] | Error,
}))
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '/api' },
}))
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('@/lib/axios', () => ({ default: api }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/workspace', () => ({
  refreshWorkspace: vi.fn(() => Promise.resolve()),
  useWorkspace: () => ({
    projects: state.projects,
    organizations: [{ id: ORG_ID, name: 'Acme', role: state.role }],
    isLoading: false,
    error: null,
    projectsByOrg: () => state.projects,
  }),
}))

import ApiKeysPage from './ApiKeysPage'

const WEB = {
  id: 'k1',
  name: 'Web app',
  type: 'CLIENT',
  key: FULL,
  isActive: true,
  createdAt: '2026-01-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
}
const BACKEND = {
  ...WEB,
  id: 'k2',
  name: 'Backend',
  type: 'SERVER',
  expiresAt: '2020-01-01T00:00:00.000Z',
}

const MCP = {
  id: 'k4',
  name: 'Claude',
  type: 'MCP',
  key: 'tkm_abc…ef12',
  isActive: true,
  createdAt: '2026-01-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  userId: 'u1',
  projectId: 'p1',
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/orgs/${ORG_ID}/api-keys`]}>
      <Routes>
        <Route path="/orgs/:orgId/api-keys" element={<ApiKeysPage />} />
      </Routes>
    </MemoryRouter>
  )

describe('ApiKeysPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    state.role = 'ADMIN'
    state.keys = [WEB, BACKEND]
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c', name: 'Ada' },
    })
    api.get.mockReset()
    api.post.mockReset()
    api.delete.mockReset()
    toast.success.mockClear()
    api.get.mockImplementation((url: string) => {
      if (url === `/api-keys/organization/${ORG_ID}`) {
        return state.keys instanceof Error
          ? Promise.reject(state.keys)
          : Promise.resolve({ data: { apiKeys: state.keys } })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
  })

  it('lists the organization keys masked, with type, binding and expiry', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: 'API keys' })
    expect(api.get).toHaveBeenCalledWith(`/api-keys/organization/${ORG_ID}`)
    const web = within(table).getByText('Web app').closest('tr') as HTMLElement
    expect(within(web).getByText('tk_aaaa…beef')).toBeInTheDocument()
    expect(within(table).queryByText(FULL)).toBeNull()
    expect(within(web).getByText('Client')).toBeInTheDocument()
    expect(within(web).getByText('Never used')).toBeInTheDocument()
    const backend = within(table)
      .getByText('Backend')
      .closest('tr') as HTMLElement
    expect(within(backend).getByText('Server')).toBeInTheDocument()
    expect(within(backend).getByText(/^Expired/)).toBeInTheDocument()
    expect(
      within(table).queryByRole('columnheader', { name: /environment/i })
    ).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith(`/projects/organization/${ORG_ID}`)
  })

  it('explains CLIENT and SERVER keys', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(screen.getAllByText(/browser/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/secret/i).length).toBeGreaterThan(0)
  })

  it('creates a key and shows it once until saving is confirmed', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({
      data: {
        apiKey: {
          id: 'k3',
          name: 'Worker',
          type: 'SERVER',
          key: 'tk_plain_secret_value',
        },
      },
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New API key' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Worker')
    await user.click(within(dialog).getByRole('radio', { name: /Server/ }))
    await user.selectOptions(within(dialog).getByLabelText('Expires'), '90')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/api-keys/organization/${ORG_ID}`,
        {
          name: 'Worker',
          type: 'SERVER',
          expiresInDays: 90,
        }
      )
    )
    const shown = await screen.findByRole('dialog', { name: 'API key created' })
    expect(
      within(shown).getByDisplayValue('tk_plain_secret_value')
    ).toBeInTheDocument()
    // Admins can copy keys later, so the dialog must not claim "only once".
    expect(shown).not.toHaveTextContent(/only once/i)
    expect(
      within(shown).getByText(/admins can copy the full key later/i)
    ).toBeInTheDocument()
    const done = within(shown).getByRole('button', { name: 'Done' })
    expect(done).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(
      screen.getByRole('dialog', { name: 'API key created' })
    ).toBeInTheDocument()
    await user.click(within(shown).getByRole('checkbox'))
    await user.click(done)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sends no expiry for keys that never expire', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({
      data: { apiKey: { id: 'k3', name: 'Web', type: 'CLIENT', key: 'tk_x' } },
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New API key' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Web')
    await user.selectOptions(within(dialog).getByLabelText('Expires'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/api-keys/organization/${ORG_ID}`,
        {
          name: 'Web',
          type: 'CLIENT',
        }
      )
    )
  })

  it('deletes a key after confirmation', async () => {
    const user = userEvent.setup()
    api.delete.mockResolvedValue({ data: { success: true } })
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Delete Web app' })
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete key' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api-keys/k1'))
    await waitFor(() => expect(screen.queryByText('Web app')).toBeNull())
  })

  it('is read-only for viewers', async () => {
    state.role = 'VIEWER'
    state.keys = [{ ...WEB, key: 'tk_aaaa…beef' }]
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'New API key' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
    expect(screen.getByText(/masked/i)).toBeInTheDocument()
  })

  it('shows an empty state and a load error', async () => {
    state.keys = []
    const { unmount } = renderPage()
    expect(await screen.findByText('No API keys yet')).toBeInTheDocument()
    unmount()
    state.keys = new Error('down')
    renderPage()
    expect(
      await screen.findByText('The API keys could not be loaded.')
    ).toBeInTheDocument()
  })

  describe('key types and roles', () => {
    const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(
        await screen.findByRole('button', { name: 'New API key' })
      )
      return screen.findByRole('dialog')
    }

    it('admin is offered CLIENT, SERVER and MCP', async () => {
      const user = userEvent.setup()
      renderPage()
      const dialog = await openCreate(user)
      expect(within(dialog).getAllByRole('radio')).toHaveLength(3)
      expect(
        within(dialog).getByRole('radio', { name: /Client/ })
      ).toBeChecked()
      expect(
        within(dialog).getByRole('radio', { name: /Server/ })
      ).toBeInTheDocument()
    })

    it('members can create only MCP keys and delete only their own', async () => {
      state.role = 'MEMBER'
      state.keys = [
        { ...WEB, key: 'tk_aaaa…beef', userId: 'u1' },
        { ...MCP, userId: 'u1' },
        { ...MCP, id: 'k5', name: 'Other MCP', userId: 'u2' },
      ]
      const user = userEvent.setup()
      renderPage()
      const table = await screen.findByRole('table', { name: 'API keys' })
      expect(
        within(table).queryByRole('button', { name: 'Delete Web app' })
      ).toBeNull()
      expect(
        within(table).getByRole('button', { name: 'Delete Claude' })
      ).toBeInTheDocument()
      expect(
        within(table).queryByRole('button', { name: 'Delete Other MCP' })
      ).toBeNull()
      const dialog = await openCreate(user)
      const radios = within(dialog).getAllByRole('radio')
      expect(radios).toHaveLength(1)
      expect(radios[0]).toBeChecked()
      expect(within(dialog).getByLabelText('Project')).toBeInTheDocument()
      expect(dialog).toHaveTextContent(/MCP key lets an AI tool/)
      expect(dialog).not.toHaveTextContent(/Client and Server keys/)
    })

    it('viewers get no create button and no MCP explanation', async () => {
      state.role = 'VIEWER'
      state.keys = [MCP]
      renderPage()
      await screen.findByRole('table')
      expect(screen.queryByRole('button', { name: 'New API key' })).toBeNull()
      expect(screen.queryByText(/AI tools/i)).toBeNull()
    })

    it('viewers (e.g. downgraded creators) see and delete only their own MCP keys', async () => {
      state.role = 'VIEWER'
      state.keys = [
        { ...WEB, key: 'tk_aaaa…beef' },
        { ...MCP, userId: 'u1' },
        { ...MCP, id: 'k5', name: 'Other MCP', userId: 'u2' },
      ]
      api.delete.mockResolvedValue({ data: { success: true } })
      const user = userEvent.setup()
      renderPage()
      const table = await screen.findByRole('table', { name: 'API keys' })
      expect(within(table).getByText('Claude')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'New API key' })).toBeNull()
      expect(
        within(table).queryByRole('button', { name: 'Delete Web app' })
      ).toBeNull()
      expect(
        within(table).queryByRole('button', { name: 'Delete Other MCP' })
      ).toBeNull()
      await user.click(
        within(table).getByRole('button', { name: 'Delete Claude' })
      )
      const dialog = await screen.findByRole('dialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'Delete key' })
      )
      await waitFor(() =>
        expect(api.delete).toHaveBeenCalledWith('/api-keys/k4')
      )
    })
  })

  describe('MCP keys', () => {
    const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(
        await screen.findByRole('button', { name: 'New API key' })
      )
      return screen.findByRole('dialog')
    }
    const created = {
      data: {
        apiKey: {
          id: 'k4',
          name: 'Claude',
          type: 'MCP',
          key: 'tkm_secret_value',
        },
      },
    }

    it('lists type, project name and last use of an MCP key', async () => {
      state.keys = [
        { ...MCP, lastUsedAt: '2026-02-03T10:00:00.000Z' },
        { ...MCP, id: 'k6', name: 'Gone', projectId: 'deleted' },
      ]
      renderPage()
      const table = await screen.findByRole('table', { name: 'API keys' })
      const row = within(table).getByText('Claude').closest('tr') as HTMLElement
      expect(within(row).getByText('MCP')).toBeInTheDocument()
      expect(within(row).getByText('Shop')).toBeInTheDocument()
      expect(within(row).getByText('tkm_abc…ef12')).toBeInTheDocument()
      expect(within(row).queryByText('Never used')).toBeNull()
      const gone = within(table).getByText('Gone').closest('tr') as HTMLElement
      expect(within(gone).getByText('Unknown project')).toBeInTheDocument()
    })

    it('requires a project and sends type and projectId', async () => {
      const user = userEvent.setup()
      api.post.mockResolvedValue(created)
      renderPage()
      const dialog = await openCreate(user)
      expect(within(dialog).queryByLabelText('Project')).toBeNull()
      await user.type(within(dialog).getByLabelText('Name'), 'Claude')
      await user.click(within(dialog).getByRole('radio', { name: /MCP/ }))
      const select = within(dialog).getByLabelText('Project')
      expect(select).toBeRequired()
      expect(
        within(dialog).getByRole('button', { name: 'Create' })
      ).toBeDisabled()
      await user.selectOptions(select, 'p2')
      await user.selectOptions(within(dialog).getByLabelText('Expires'), '90')
      await user.click(within(dialog).getByRole('button', { name: 'Create' }))
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          `/api-keys/organization/${ORG_ID}`,
          { name: 'Claude', type: 'MCP', projectId: 'p2', expiresInDays: 90 }
        )
      )
    })

    it('keeps the dialog open and shows the error when creating fails', async () => {
      const user = userEvent.setup()
      api.post.mockRejectedValue(new Error('boom'))
      renderPage()
      const dialog = await openCreate(user)
      await user.type(within(dialog).getByLabelText('Name'), 'Claude')
      await user.click(within(dialog).getByRole('radio', { name: /MCP/ }))
      await user.selectOptions(within(dialog).getByLabelText('Project'), 'p1')
      await user.click(within(dialog).getByRole('button', { name: 'Create' }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'The API key could not be created.'
      )
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(
        screen.queryByRole('dialog', { name: 'API key created' })
      ).toBeNull()
      expect(document.body.innerHTML).not.toContain('tkm_')
    })

    it('shows the key and the client configuration once, then removes them', async () => {
      const user = userEvent.setup()
      api.post.mockResolvedValue(created)
      renderPage()
      const dialog = await openCreate(user)
      await user.type(within(dialog).getByLabelText('Name'), 'Claude')
      await user.click(within(dialog).getByRole('radio', { name: /MCP/ }))
      await user.selectOptions(within(dialog).getByLabelText('Project'), 'p1')
      await user.click(within(dialog).getByRole('button', { name: 'Create' }))

      const shown = await screen.findByRole('dialog', {
        name: 'API key created',
      })
      expect(
        within(shown).getByDisplayValue('tkm_secret_value')
      ).toBeInTheDocument()
      const snippet = JSON.parse(
        (shown.querySelector('pre code') as HTMLElement).textContent ?? ''
      )
      expect(snippet).toEqual({
        mcpServers: {
          translately: {
            type: 'http',
            url: `${window.location.origin}/api/mcp`,
            headers: { Authorization: 'Bearer tkm_secret_value' },
          },
        },
      })
      expect(shown).toHaveTextContent(/will not be shown again/i)
      expect(shown).not.toHaveTextContent(/admins can copy/i)

      await user.click(within(shown).getByRole('checkbox'))
      await user.click(within(shown).getByRole('button', { name: 'Done' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.body.innerHTML).not.toContain('tkm_secret_value')
    })
  })
})
