import { createInstance } from 'i18next'
import { buildTree } from './translation-tree'

describe('i18next compatibility of delivered files', () => {
  it('resolves nested keys and plurals from a buildTree file', async () => {
    const tree = buildTree({
      'checkout.submit': 'Jetzt kaufen',
      'cart.items_one': '{{count}} Artikel',
      'cart.items_other': '{{count}} Artikel gesamt',
    })

    const i18n = createInstance()
    await i18n.init({
      lng: 'de',
      resources: { de: { translation: tree } },
    })

    expect(i18n.t('checkout.submit')).toBe('Jetzt kaufen')
    expect(i18n.t('cart.items', { count: 1 })).toBe('1 Artikel')
    expect(i18n.t('cart.items', { count: 3 })).toBe('3 Artikel gesamt')
  })
})
