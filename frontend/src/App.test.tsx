import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('./lib/setup', () => {
  const status = {
    setupRequired: false,
    mailEnabled: false,
    setupTokenRequired: false,
  }
  return {
    fetchSetupStatus: () => Promise.resolve(status),
    useSetupStatus: () => status,
  }
})
vi.mock('./components/ProtectedRoute', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./components/shell/AppShell', () => ({
  default: function ShellStub() {
    const { pathname } = useLocation()
    return (
      <>
        <div data-testid="where">{pathname}</div>
        <Outlet />
      </>
    )
  },
}))
vi.mock('./pages/overview/OverviewPage', () => ({
  default: () => <h1>overview page</h1>,
}))

import App from './App'

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>
  )
}

describe('App routing', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it.each([
    '/feature-flags',
    '/feature-flags/f1',
    '/experiments',
    '/sdk-tester',
    '/projects/p1/flags',
  ])('sends the old bookmark %s to the overview', async (url) => {
    renderAt(url)
    expect(
      await screen.findByRole('heading', { name: 'overview page' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/overview$/)
  })

  it('opens the translations of a project without a section', async () => {
    renderAt('/projects/p1')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Translations' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(
      /^\/projects\/p1\/translations$/
    )
  })
})
