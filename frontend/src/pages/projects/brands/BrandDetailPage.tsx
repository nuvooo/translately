import { Building2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { PageHeader } from '@/components/page/PageHeader'
import { SettingsSection } from '@/components/page/SettingsSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import api from '@/lib/axios'
import { getErrorStatus } from '@/lib/errors'
import { useProjectRole } from '@/lib/permissions'
import { projectPath } from '@/lib/routes'
import { fetchProject, type ProjectDetails } from '../settings/project'
import { LanguagesDialog } from '../translations/LanguagesDialog'

interface Brand {
  id: string
  name: string
  key: string
  description: string | null
  /** Own language list of the brand (independent of the project's). */
  languages?: string[]
}

/** Master data of one brand (name, key, description) and its languages. */
export default function BrandDetailPage() {
  const { t } = useTranslation()
  const { projectId = '', brandId } = useParams<{
    projectId: string
    brandId: string
  }>()
  const { canManage } = useProjectRole(projectId)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [languagesOpen, setLanguagesOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<'not-found' | 'failed' | null>(
    null
  )

  const load = useCallback(async () => {
    if (!brandId) return
    setIsLoading(true)
    setLoadError(null)
    try {
      // The project tells whether brands have languages (MULTI) and which
      // project languages to suggest.
      const [response, loadedProject] = await Promise.all([
        api.get(`/brands/project/${projectId}`),
        fetchProject(projectId),
      ])
      const brands: Brand[] = response.data.brands ?? []
      const found = brands.find((b) => b.id === brandId) ?? null
      setBrand(found)
      setProject(loadedProject ?? null)
      if (!found) setLoadError('not-found')
    } catch (error) {
      setLoadError(getErrorStatus(error) === 404 ? 'not-found' : 'failed')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, brandId])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Quiet re-fetch after the languages dialog hit a changed list (409): the
   * page stays as it is, only brand and project data are replaced.
   */
  const refreshLanguages = async () => {
    try {
      const [response, loadedProject] = await Promise.all([
        api.get(`/brands/project/${projectId}`),
        fetchProject(projectId),
      ])
      const brands: Brand[] = response.data.brands ?? []
      const found = brands.find((b) => b.id === brandId)
      if (found) setBrand(found)
      if (loadedProject) setProject(loadedProject)
    } catch {
      // The dialog keeps its notice; the next save checks the server again.
    }
  }

  const languages = brand?.languages ?? []
  const brandsLink = projectPath(projectId, 'brands')
  const breadcrumb = [
    { label: t('brands-page.title'), to: brandsLink },
    { label: brand?.name ?? '…' },
  ]

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
        <PageHeader
          title={<Skeleton className="h-6 w-40" />}
          breadcrumb={breadcrumb}
        />
        <span role="status" className="sr-only">
          {t('common.loading')}
        </span>
      </div>
    )
  }

  if (loadError || !brand) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title={t('brands-page.detail.title-fallback')}
          breadcrumb={breadcrumb}
        />
        {loadError === 'failed' ? (
          <ErrorState
            message={t('brands-page.detail.load-error')}
            onRetry={load}
          />
        ) : (
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title={t('brands-page.detail.not-found-title')}
            description={t('brands-page.detail.not-found-text')}
            action={
              <Button variant="outline" asChild>
                <Link to={brandsLink}>{t('brands-page.detail.back')}</Link>
              </Button>
            }
          />
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={brand.name}
        breadcrumb={breadcrumb}
        meta={
          <Badge variant="outline" className="font-mono">
            {brand.key}
          </Badge>
        }
        description={brand.description || t('brands-page.detail.subtitle')}
      />
      {project?.type === 'MULTI' && (
        <SettingsSection
          title={t('brands-page.detail.languages.title')}
          description={t('brands-page.detail.languages.description')}
        >
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-4 sm:p-6">
            {languages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('brands-page.detail.languages.empty')}
              </p>
            ) : (
              <ul
                aria-label={t('brands-page.detail.languages.list')}
                className="flex min-w-0 flex-wrap gap-1.5"
              >
                {languages.map((language) => (
                  <li key={language}>
                    <Badge variant="outline" className="font-mono">
                      {language}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setLanguagesOpen(true)}>
                {t('brands-page.detail.languages.manage')}
              </Button>
            )}
          </div>
          {canManage && (
            <LanguagesDialog
              open={languagesOpen}
              onOpenChange={setLanguagesOpen}
              scope={{
                kind: 'brand',
                id: brand.id,
                name: brand.name,
                projectLanguages: project.languages ?? [],
              }}
              languages={languages}
              onSaved={(saved) =>
                // The server's list is authoritative; no reload needed.
                setBrand((current) =>
                  current ? { ...current, languages: saved } : current
                )
              }
              onStale={refreshLanguages}
            />
          )}
        </SettingsSection>
      )}
    </div>
  )
}
