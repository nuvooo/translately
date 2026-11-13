import { describe, expect, it } from 'vitest'
import {
  brandPath,
  getArea,
  orgPath,
  PROJECT_SECTIONS,
  projectPath,
  ROUTES,
  webhookPath,
} from './routes'

describe('routes', () => {
  it('builds project and org paths', () => {
    expect(projectPath('p1')).toBe('/projects/p1/translations')
    expect(projectPath('p1', 'brands')).toBe('/projects/p1/brands')
    expect(PROJECT_SECTIONS).not.toContain('environments')
    expect(orgPath('o1')).toBe('/orgs/o1/projects')
    expect(orgPath('o1', 'audit-log')).toBe('/orgs/o1/audit-log')
  })

  it('builds detail paths', () => {
    expect(brandPath('p1', 'b1')).toBe('/projects/p1/brands/b1')
    expect(webhookPath('p1', 'w1')).toBe('/projects/p1/webhooks/w1')
  })

  it('nutzt translations als Standard-Abschnitt', () => {
    expect(projectPath('p1')).toBe('/projects/p1/translations')
    expect(getArea('/projects/p1')).toEqual({
      area: 'project',
      id: 'p1',
      section: 'translations',
    })
  })

  it('behandelt alte Flag-Pfade als translations', () => {
    expect(getArea('/projects/p1/flags')).toEqual({
      area: 'project',
      id: 'p1',
      section: 'translations',
    })
  })

  it('exposes static routes', () => {
    expect(ROUTES).toEqual({
      overview: '/overview',
      orgs: '/orgs',
      newOrg: '/orgs/new',
      account: '/account',
      projects: '/projects',
    })
  })

  it.each([
    ['/overview', { area: 'overview' }],
    ['/projects', { area: 'project-picker' }],
    ['/projects/', { area: 'project-picker' }],
    [
      '/projects/p1/translations',
      { area: 'project', id: 'p1', section: 'translations' },
    ],
    ['/projects/p1', { area: 'project', id: 'p1', section: 'translations' }],
    [
      '/projects/p1/webhooks/w1',
      { area: 'project', id: 'p1', section: 'webhooks' },
    ],
    ['/orgs/o1/members', { area: 'org', id: 'o1', section: 'members' }],
    ['/orgs/o1', { area: 'org', id: 'o1', section: 'projects' }],
    ['/orgs/new', { area: 'org' }],
    ['/account', { area: 'account' }],
    ['/something', { area: 'overview' }],
  ])('detects area for %s', (path, expected) => {
    expect(getArea(path)).toEqual(expected)
  })
})
