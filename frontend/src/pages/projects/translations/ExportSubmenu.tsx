import { Download, FileArchive } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { handleForbidden } from '@/lib/permissions'
import { exportFile } from './api'
import { LanguageFlag } from './LanguageFlag'
import { saveBlobAsFile } from './saveBlob'
import { zipFiles } from './zip'

/** Radio value of the standard texts. */
const STANDARD = '__standard__'

type Brand = { id: string; key: string; name: string; languages: string[] }

interface ExportOptions {
  projectId: string
  /** Names the ZIP archive. */
  projectKey: string
  /** Brands of a MULTI project; empty = only the standard texts. */
  brands: Brand[]
  projectLanguages: string[]
  namespace: string
}

export interface ExportState {
  /** A download is running. */
  busy: boolean
  /** Chosen target; null = the standard texts. */
  brand: Brand | null
  chooseBrand(brandId: string | null): void
  /** Languages of the chosen target. */
  languages: string[]
  /** Neither the project nor any brand has a language. */
  unavailable: boolean
  download(language: string): Promise<void>
  /** Downloads all languages of the chosen target as one ZIP archive. */
  downloadAll(): Promise<void>
}

/**
 * State of the export. It lives outside the menu, which unmounts its content
 * when it closes: the running download and the chosen target survive that.
 */
export function useExport({
  projectId,
  projectKey,
  brands,
  projectLanguages,
  namespace,
}: ExportOptions): ExportState {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [brandId, setBrandId] = useState<string | null>(null)
  // A brand that is gone (e.g. after a reload) falls back to the standard texts.
  const brand = brands.find((b) => b.id === brandId) ?? null
  const languages = brand ? brand.languages : projectLanguages
  const unavailable =
    projectLanguages.length === 0 &&
    brands.every((b) => b.languages.length === 0)

  const download = async (language: string) => {
    setBusy(true)
    try {
      const blob = await exportFile(projectId, {
        language,
        namespace,
        ...(brand ? { brandId: brand.id } : {}),
      })
      saveBlobAsFile(blob, `${namespace}.${language}.json`)
    } catch (error) {
      if (!handleForbidden(error, t))
        toast.error(t('translations.export.failed'))
    } finally {
      setBusy(false)
    }
  }

  const downloadAll = async () => {
    setBusy(true)
    try {
      const files: { name: string; blob: Blob }[] = []
      // One after the other: the export endpoint is rate limited like any other.
      for (const language of languages) {
        const blob = await exportFile(projectId, {
          language,
          namespace,
          ...(brand ? { brandId: brand.id } : {}),
        })
        files.push({ name: `${namespace}.${language}.json`, blob })
      }
      // Nothing is saved unless every language arrived.
      const archive = [projectKey, ...(brand ? [brand.key] : []), namespace]
      saveBlobAsFile(await zipFiles(files), `${archive.join('.')}.zip`)
    } catch (error) {
      if (!handleForbidden(error, t))
        toast.error(t('translations.export.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    brand,
    chooseBrand: setBrandId,
    languages,
    unavailable,
    download,
    downloadAll,
  }
}

interface ExportSubmenuProps {
  state: ExportState
  brands: Brand[]
  /** Blocks the export, e.g. while the rows on screen belong to another namespace. */
  disabled?: boolean
}

/**
 * The export entry of the actions menu: downloads one language file as JSON,
 * or all languages as one ZIP archive. With brands, the submenu first offers
 * the target (standard texts or a brand) and below it the target's
 * languages; without brands it is a plain entry for a single language and a
 * submenu with one entry per language otherwise.
 */
export function ExportSubmenu({
  state,
  brands,
  disabled = false,
}: ExportSubmenuProps) {
  const { t } = useTranslation()
  const { brand, languages } = state
  const blocked = disabled || state.busy
  const label = (
    <>
      <Download className="mr-2 h-4 w-4" aria-hidden />
      {t('translations.export.button')}
    </>
  )

  if (state.unavailable) {
    return (
      <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
        <span className="flex items-center">{label}</span>
        <span className="pl-6 text-xs">
          {t('translations.export.unavailable')}
        </span>
      </DropdownMenuItem>
    )
  }

  if (brands.length === 0 && languages.length === 1) {
    return (
      <DropdownMenuItem
        disabled={blocked}
        onSelect={() => void state.download(languages[0])}
      >
        {label}
      </DropdownMenuItem>
    )
  }

  const targetLabel = t('translations.target.label')
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={blocked}>
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {brands.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              {targetLabel}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label={targetLabel}
              value={brand?.id ?? STANDARD}
              onValueChange={(value) =>
                state.chooseBrand(value === STANDARD ? null : value)
              }
            >
              <DropdownMenuRadioItem
                value={STANDARD}
                // Choosing the target keeps the menu open for the language.
                onSelect={(event) => event.preventDefault()}
              >
                {t('translations.target.standard')}
              </DropdownMenuRadioItem>
              {brands.map((b) => (
                <DropdownMenuRadioItem
                  key={b.id}
                  value={b.id}
                  onSelect={(event) => event.preventDefault()}
                >
                  {b.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {languages.length === 0 ? (
          <DropdownMenuItem disabled>
            {t('translations.export.unavailable')}
          </DropdownMenuItem>
        ) : (
          <>
            {languages.length > 1 && (
              <>
                <DropdownMenuItem onSelect={() => void state.downloadAll()}>
                  <FileArchive className="mr-2 h-4 w-4" aria-hidden />
                  {t('translations.export.all-zip')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {languages.map((language) => (
              <DropdownMenuItem
                key={language}
                onSelect={() => void state.download(language)}
              >
                <LanguageFlag language={language} className="mr-2" />
                {language}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
