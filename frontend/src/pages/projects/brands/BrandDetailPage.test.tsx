import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const PROJECT_ID = '0123456789abcdef01234567'
const BRAND_ID = 'brand-a'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
const role = vi.hoisted(() => ({ current: 'ADMIN' }))
const project = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))

vi.mock('@/lib/axios', () => ({ default: api }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/workspace', () => ({
  refreshWorkspace: vi.fn(() => Promise.resolve()),
  useWorkspace: () => ({
    projects: [
      {
        id: '0123456789abcdef01234567',
        name: 'Shop',
        key: 'shop',
        type: 'MULTI',
        organizationId: 'o1',
      },
    ],
    organizations: [{ id: 'o1', name: 'Acme', role: role.current }],
    isLoading: false,
    error: null,
    projectsByOrg: () => [],
  }),
}))

import BrandDetailPage from './BrandDetailPage'

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[`/projects/${PROJECT_ID}/brands/${BRAND_ID}`]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/brands/:brandId"
          element={<BrandDetailPage />}
        />
      </Routes>
    </MemoryRouter>
  )
}

const alpha = {
  id: BRAND_ID,
  name: 'Alpha',
  key: 'alpha',
  description: 'Main brand',
  languages: ['de', 'it'],
}

const baseProject = () => ({
  id: PROJECT_ID,
  name: 'Shop',
  key: 'shop',
  type: 'MULTI',
  languages: ['de', 'en', 'fr'],
  namespaces: ['translation'],
})

let brandsResponse: unknown[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  role.current = 'ADMIN'
  project.current = baseProject()
  brandsResponse = [
    {
      id: 'brand-b',
      name: 'Beta',
      key: 'beta',
      description: null,
      languages: [],
    },
    alpha,
  ]
  api.get.mockImplementation((url: string) => {
    if (url === `/projects/${PROJECT_ID}`)
      return Promise.resolve({ data: { project: project.current } })
    return Promise.resolve({ data: { brands: brandsResponse } })
  })
})

describe('BrandDetailPage layout and states', () => {
  it('shows the brand in the page header with a breadcrumb to the brands list', async () => {
    renderPage()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    ).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith(`/brands/project/${PROJECT_ID}`)
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Main brand')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Brands' })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/brands`
    )
  })

  it('shows "not found" for a brand that is not in the project', async () => {
    api.get.mockResolvedValue({ data: { brands: [] } })
    renderPage()
    expect(await screen.findByText('Brand not found')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to brands' })
    ).toBeInTheDocument()
  })

  it('shows "not found" for an unknown project', async () => {
    api.get.mockRejectedValue({
      isAxiosError: true,
      message: 'Not Found',
      response: { status: 404, data: {} },
    })
    renderPage()
    expect(await screen.findByText('Brand not found')).toBeInTheDocument()
  })

  it('shows an error state with retry when loading fails', async () => {
    api.get.mockRejectedValueOnce(new Error('down'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The brand could not be loaded.'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    ).toBeInTheDocument()
  })
})

describe('BrandDetailPage languages', () => {
  const section = () => screen.getByRole('region', { name: 'Languages' })

  it('shows the brand languages as badges and lets an ADMIN manage them', async () => {
    const user = userEvent.setup()
    api.put.mockResolvedValue({
      data: { languages: ['de', 'it', 'en'], removedValues: 0 },
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    expect(within(section()).getByText('de')).toBeInTheDocument()
    expect(within(section()).getByText('it')).toBeInTheDocument()

    await user.click(within(section()).getByRole('button', { name: 'Manage' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', {
        name: 'Languages of the brand “Alpha”',
      })
    ).toBeInTheDocument()
    // The project languages the brand does not offer yet are suggested.
    await user.click(within(dialog).getByRole('button', { name: 'Add en' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(`/brands/${BRAND_ID}/languages`, {
        languages: ['de', 'it', 'en'],
        expected: ['de', 'it'],
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(within(section()).getByText('en')).toBeInTheDocument()
  })

  it('shows "no languages" for a brand without its own list', async () => {
    brandsResponse = [{ ...alpha, languages: [] }]
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    expect(
      within(section()).getByText('This brand has no languages yet.')
    ).toBeInTheDocument()
  })

  it('MEMBER and VIEWER see the languages without a manage button', async () => {
    role.current = 'MEMBER'
    const { unmount } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    expect(within(section()).getByText('de')).toBeInTheDocument()
    expect(
      within(section()).queryByRole('button', { name: 'Manage' })
    ).not.toBeInTheDocument()
    unmount()
    role.current = 'VIEWER'
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull()
  })

  it('has no languages section in a SINGLE project', async () => {
    project.current = { ...baseProject(), type: 'SINGLE' }
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    expect(screen.queryByRole('region', { name: 'Languages' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull()
  })

  it('reloads the brand after a conflict and the dialog takes the fresh list', async () => {
    const user = userEvent.setup()
    api.put.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: {} },
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Alpha' })
    await user.click(within(section()).getByRole('button', { name: 'Manage' }))
    // Meanwhile another admin added `fr` to the brand.
    brandsResponse = [{ ...alpha, languages: ['de', 'it', 'fr'] }]
    const gets = api.get.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Remove it' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Remove and save' }))
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(gets))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The page behind the modal is aria-hidden; look past that.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('region', { name: 'Languages', hidden: true })
        ).getByText('fr')
      ).toBeInTheDocument()
    )
    api.put.mockResolvedValueOnce({
      data: { languages: ['de'], removedValues: 2 },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('it, fr')
    await user.click(screen.getByRole('button', { name: 'Remove and save' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenLastCalledWith(
        `/brands/${BRAND_ID}/languages`,
        {
          languages: ['de'],
          expected: ['de', 'it', 'fr'],
        }
      )
    )
  })
})
