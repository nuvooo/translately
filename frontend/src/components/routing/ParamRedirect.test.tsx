import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ParamRedirect } from './ParamRedirect'

function Where() {
  const { pathname, search, hash } = useLocation()
  return <div data-testid="where">{pathname + search + hash}</div>
}

describe('ParamRedirect', () => {
  it('maps params into a new path', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/o1/members']}>
        <Routes>
          <Route
            path="/organizations/:orgId/members"
            element={<ParamRedirect to="/orgs/:orgId/members" />}
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('where')).toHaveTextContent(
      /^\/orgs\/o1\/members$/
    )
  })

  it('keeps query string and hash when mapping params', () => {
    render(
      <MemoryRouter
        initialEntries={['/organizations/o1/members?tab=invites#pending']}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/members"
            element={<ParamRedirect to="/orgs/:orgId/members" />}
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/orgs/o1/members?tab=invites#pending'
    )
  })
})
