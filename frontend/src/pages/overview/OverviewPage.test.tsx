import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: { get: mocks.get } }))

import OverviewPage from './OverviewPage'

function Where() {
  const { pathname } = useLocation()
  return <div data-testid="where">{pathname}</div>
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )

const recent = new Date(Date.now() - 2 * 3600 * 1000).toISOString()

const overview = {
  counts: {
    organizations: 2,
    projects: 3,
  },
  projects: [
    {
      id: 'p1',
      name: 'Shop',
      key: 'shop',
      type: 'SINGLE',
      organizationId: 'o1',
      organizationName: 'Acme',
      brandCount: 0,
      keyCount: 3,
      languageCount: 2,
      missingCount: 5,
      updatedAt: recent,
    },
    {
      id: 'p2',
      name: 'App',
      key: 'app',
      type: 'MULTI',
      organizationId: 'o2',
      organizationName: 'Globex',
      brandCount: 4,
      keyCount: 1200,
      languageCount: 3,
      missingCount: 0,
      updatedAt: recent,
    },
    {
      id: 'p3',
      name: 'Blog',
      key: 'blog',
      type: 'SINGLE',
      organizationId: 'o1',
      organizationName: 'Acme',
      brandCount: 0,
      keyCount: 0,
      languageCount: 2,
      missingCount: 0,
      updatedAt: recent,
    },
  ],
}

describe('OverviewPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.get.mockReset()
    mocks.get.mockResolvedValue({ data: overview })
  })

  it('shows the key figures from GET /overview', async () => {
    renderPage()
    const figure = async (label: RegExp) =>
      (await screen.findByText(label)).closest('div')?.parentElement
    expect(await figure(/^organizations$/i)).toHaveTextContent('2')
    expect(mocks.get).toHaveBeenCalledWith('/overview')
  })

  it('lists the projects with organization and counts and opens one on row click', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: /projects/i })
    expect(
      within(table).queryByRole('columnheader', {
        name: /environment|umgebung/i,
      })
    ).toBeNull()
    expect(within(table).getByRole('link', { name: /^shop/i })).toHaveAttribute(
      'href',
      '/projects/p1/translations'
    )
    expect(within(table).getByText('Globex')).toBeInTheDocument()
    const app = within(table).getByText('Globex').closest('tr') as HTMLElement
    expect(within(app).getByText('4')).toBeInTheDocument()
    expect(within(table).getByText('Multi-brand')).toBeInTheDocument()
    fireEvent.click(within(table).getByText('Globex'))
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/projects/p2/translations'
    )
  })

  it('shows keys, languages and missing texts per project', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: /projects/i })
    const row = (name: string) =>
      within(table).getByText(name).closest('tr') as HTMLElement

    // Missing texts link to the translations page and are highlighted
    const shop = row('Shop')
    expect(within(shop).getByText('3')).toBeInTheDocument()
    const missing = within(shop).getByRole('link', {
      name: /5 missing texts in shop/i,
    })
    expect(missing).toHaveAttribute('href', '/projects/p1/translations')
    expect(within(missing).getByText('5 missing').className).toMatch(/warning/)

    // Nothing missing: neutral "complete", formatted numbers, no link
    const app = row('App')
    expect(within(app).getByText('1,200')).toBeInTheDocument()
    expect(within(app).getByText('complete').className).not.toMatch(/warning/)
    expect(within(app).queryByRole('link', { name: /missing/i })).toBeNull()

    // No keys yet: a hint instead of "complete"
    const blog = row('Blog')
    expect(within(blog).getByText('No keys yet')).toBeInTheDocument()
    expect(within(blog).queryByText('complete')).toBeNull()
  })

  it('names missing texts in German', async () => {
    await i18n.changeLanguage('de')
    renderPage()
    const table = await screen.findByRole('table', { name: /projekte/i })
    expect(
      within(table).getByRole('link', { name: /5 fehlende Texte in Shop/i })
    ).toHaveTextContent('5 fehlen')
    expect(within(table).getByText('vollständig')).toBeInTheDocument()
    expect(within(table).getByText('1.200')).toBeInTheDocument()
  })

  it('shows a hint for a project without languages', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...overview,
        projects: [
          { ...overview.projects[0], languageCount: 0, missingCount: 0 },
        ],
      },
    })
    renderPage()
    const table = await screen.findByRole('table', { name: /projects/i })
    expect(within(table).getByText('No languages yet')).toBeInTheDocument()
    expect(within(table).queryByText('complete')).toBeNull()
  })

  it('invites users without organizations to create one', async () => {
    mocks.get.mockResolvedValue({
      data: {
        counts: {
          organizations: 0,
          projects: 0,
        },
        projects: [],
      },
    })
    renderPage()
    expect(await screen.findByText(/no organization yet/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /create organization/i })
    ).toHaveAttribute('href', '/orgs/new')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows a loading state and an error with retry', async () => {
    mocks.get.mockRejectedValueOnce(new Error('down'))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be loaded/i
    )
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(
      await screen.findByRole('table', { name: /projects/i })
    ).toBeInTheDocument()
  })
})
