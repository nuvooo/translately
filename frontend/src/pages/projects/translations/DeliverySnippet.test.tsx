import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { DeliverySnippetDialog } from './DeliverySnippet'

const BRAND = { id: 'b1', key: 'premium', name: 'Premium', languages: ['en'] }

type Props = ComponentProps<typeof DeliverySnippetDialog>

function snippet(props: Partial<Props> = {}) {
  return (
    <MemoryRouter>
      <DeliverySnippetDialog
        open
        onOpenChange={() => {}}
        projectKey="shop"
        brands={[]}
        projectLanguages={['de', 'en']}
        organizationId="o1"
        {...props}
      />
    </MemoryRouter>
  )
}

const renderSnippet = (props: Partial<Props> = {}) => render(snippet(props))

const code = () =>
  within(screen.getByRole('dialog')).getByText(/i18next\.use\(HttpBackend\)/)

describe('DeliverySnippet', () => {
  beforeAll(async () => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the snippet for the default texts', () => {
    renderSnippet()

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText('Konfiguration für die Standardtexte.')
    ).toBeInTheDocument()
    expect(code().tagName).toBe('CODE')
    expect(code()).toHaveTextContent(
      `${window.location.origin}/sdk/translations/shop/{{lng}}/{{ns}}'`
    )
    expect(code()).not.toHaveTextContent('brandKey')
    expect(code()).toHaveTextContent("fallbackLng: 'de'")
    expect(code()).toHaveTextContent('<YOUR_API_KEY>')
    expect(dialog.textContent).not.toMatch(/environment/i)
  })

  it('without brands there is no target selection', () => {
    renderSnippet()
    expect(
      within(screen.getByRole('dialog')).queryByRole('combobox', {
        name: 'Ziel',
      })
    ).toBeNull()
  })

  it('follows the chosen brand: brandKey and the brand languages', async () => {
    const user = userEvent.setup()
    renderSnippet({ brands: [BRAND] })
    const dialog = screen.getByRole('dialog')
    expect(code()).not.toHaveTextContent('brandKey')

    await user.click(within(dialog).getByRole('combobox', { name: 'Ziel' }))
    await user.click(await screen.findByRole('option', { name: 'Premium' }))

    expect(
      within(dialog).getByText('Konfiguration für die Brand „Premium“.')
    ).toBeInTheDocument()
    expect(code()).toHaveTextContent(
      `${window.location.origin}/sdk/translations/shop/{{lng}}/{{ns}}?brandKey=premium'`
    )
    expect(code()).toHaveTextContent("fallbackLng: 'en'")
    expect(dialog.textContent).not.toMatch(/environment/i)
  })

  it('starts with the default texts again when it is reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSnippet({ brands: [BRAND] })
    await user.click(
      within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Ziel' })
    )
    await user.click(await screen.findByRole('option', { name: 'Premium' }))
    expect(code()).toHaveTextContent('brandKey=premium')

    rerender(snippet({ brands: [BRAND], open: false }))
    rerender(snippet({ brands: [BRAND], open: true }))

    expect(code()).not.toHaveTextContent('brandKey')
  })

  it('links to the API keys page of the organization', () => {
    renderSnippet()
    expect(
      within(screen.getByRole('dialog')).getByRole('link', { name: 'API-Keys' })
    ).toHaveAttribute('href', '/orgs/o1/api-keys')
  })

  it('shows plain text without a link when the organization is unknown', () => {
    renderSnippet({ organizationId: undefined })
    expect(within(screen.getByRole('dialog')).queryByRole('link')).toBeNull()
  })

  it('copies the snippet', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderSnippet()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /kopieren/i,
      })
    )
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]).toEqual([
      expect.stringContaining('loadPath:'),
    ])
  })
})
