import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { toast } from 'sonner'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import i18n from '@/i18n'
import * as api from '../translations/api'
import { NamespacesSection } from './NamespacesSection'
import type { ProjectDetails } from './project'

vi.mock('../translations/api', () => ({
  addNamespace: vi.fn(),
  removeNamespace: vi.fn(),
}))
vi.mock('@/lib/workspace', () => ({
  refreshWorkspace: vi.fn(() => Promise.resolve()),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const addNamespace = vi.mocked(api.addNamespace)
const removeNamespace = vi.mocked(api.removeNamespace)

const PROJECT: ProjectDetails = {
  id: 'p1',
  name: 'Shop',
  key: 'shop',
  description: null,
  type: 'SINGLE',
  allowedOrigins: [],
  organizationId: 'o1',
  namespaces: ['translation', 'checkout'],
}

type Props = ComponentProps<typeof NamespacesSection>

function renderSection(overrides: Partial<Props> = {}) {
  const props: Props = {
    project: PROJECT,
    canManage: true,
    onSaved: vi.fn(),
    ...overrides,
  }
  render(<NamespacesSection {...props} />)
  return props
}

const list = () => screen.getByRole('list', { name: 'Namespaces' })
const input = () => screen.getByLabelText('Neuer Namespace')
const addButton = () =>
  screen.getByRole('button', { name: 'Namespace hinzufügen' })

describe('NamespacesSection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listet die Namespaces; `translation` hat keinen Entfernen-Button', () => {
    renderSection()
    const items = within(list()).getAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('data-namespace'))).toEqual([
      'translation',
      'checkout',
    ])
    expect(within(items[0]).queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Namespace translation entfernen' })
    ).not.toBeInTheDocument()
    expect(
      within(items[1]).getByRole('button', {
        name: 'Namespace checkout entfernen',
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/„translation“ kann nicht entfernt werden/)
    ).toBeInTheDocument()
  })

  it('ungültiger Name zeigt sofort einen Fehler und ruft nichts auf', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.type(input(), 'a b')
    expect(
      screen.getByText(/Nur Buchstaben, Ziffern, „_“ und „-“/)
    ).toBeInTheDocument()
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(addButton()).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(addNamespace).not.toHaveBeenCalled()
  })

  it('vorhandener Name zeigt einen Fehler', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.type(input(), 'checkout')
    expect(
      screen.getByText('„checkout“ ist bereits vorhanden.')
    ).toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('fügt einen Namespace hinzu und übernimmt die Liste vom Server', async () => {
    const user = userEvent.setup()
    addNamespace.mockResolvedValue({
      namespaces: ['translation', 'checkout', 'mobile'],
    })
    const props = renderSection()
    await user.type(input(), 'mobile{Enter}')
    await waitFor(() =>
      expect(addNamespace).toHaveBeenCalledWith('p1', 'mobile')
    )
    await waitFor(() =>
      expect(props.onSaved).toHaveBeenCalledWith({
        ...PROJECT,
        namespaces: ['translation', 'checkout', 'mobile'],
      })
    )
    expect(toast.success).toHaveBeenCalledWith(
      'Namespace „mobile“ hinzugefügt.'
    )
    expect(input()).toHaveValue('')
  })

  it('Entfernen fragt erst nach und nennt danach die Zahl gelöschter Keys', async () => {
    const user = userEvent.setup()
    removeNamespace.mockResolvedValue({
      namespaces: ['translation'],
      removedKeys: 3,
    })
    const props = renderSection()
    await user.click(
      screen.getByRole('button', { name: 'Namespace checkout entfernen' })
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Namespace „checkout“ entfernen?')
    expect(dialog).toHaveTextContent(
      'Alle Keys dieses Namespace und ihre Texte werden gelöscht'
    )
    expect(dialog).toHaveTextContent('in allen Sprachen und Brands')
    expect(removeNamespace).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Namespace entfernen' })
    )
    await waitFor(() =>
      expect(removeNamespace).toHaveBeenCalledWith('p1', 'checkout')
    )
    await waitFor(() =>
      expect(props.onSaved).toHaveBeenCalledWith({
        ...PROJECT,
        namespaces: ['translation'],
      })
    )
    expect(toast.success).toHaveBeenCalledWith(
      'Namespace „checkout“ entfernt. Gelöschte Keys: 3.'
    )
  })

  it('Abbrechen der Rückfrage entfernt nichts', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(
      screen.getByRole('button', { name: 'Namespace checkout entfernen' })
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Abbrechen',
      })
    )
    expect(removeNamespace).not.toHaveBeenCalled()
  })

  it('ohne ADMIN nur die Liste, ohne Eingabe und Buttons', () => {
    renderSection({ canManage: false })
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('bei 50 Namespaces ist Hinzufügen gesperrt', () => {
    const many = [
      'translation',
      ...Array.from({ length: 49 }, (_, i) => `ns${i}`),
    ]
    renderSection({ project: { ...PROJECT, namespaces: many } })
    expect(
      screen.getByText('Maximal 50 Namespaces erreicht.')
    ).toBeInTheDocument()
    expect(input()).toBeDisabled()
    expect(addButton()).toBeDisabled()
  })
})
