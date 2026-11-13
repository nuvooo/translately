import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Select value of the standard texts (Radix needs a non-empty value). */
const STANDARD = '__standard__'

/**
 * Chooses where a dialog works: the standard texts or one brand. Renders
 * nothing without brands, so single-brand projects never see a choice.
 */
export function TargetSelect({
  brands,
  value,
  onChange,
  disabled = false,
}: {
  brands: { id: string; name: string }[]
  /** null = standard texts */
  value: string | null
  onChange(brandId: string | null): void
  disabled?: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  if (brands.length === 0) return null
  const label = t('translations.target.label')
  return (
    <Select
      value={value ?? STANDARD}
      onValueChange={(next) => onChange(next === STANDARD ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="h-8 w-auto min-w-40 gap-2">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={STANDARD}>
          {t('translations.target.standard')}
        </SelectItem>
        {brands.map((brand) => (
          <SelectItem key={brand.id} value={brand.id}>
            {brand.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
