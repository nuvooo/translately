import { Building2, FolderKanban, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable, type DataTableColumn } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { PageHeader } from '@/components/page/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelative } from '@/lib/relativeTime'
import { projectPath, ROUTES } from '@/lib/routes'
import {
  type OverviewData,
  type OverviewProject,
  useOverview,
} from './overview'

function RelativeTime({ date }: { date: string }) {
  const { i18n } = useTranslation()
  const relative = formatRelative(date, i18n.language)
  if (!relative) return <>–</>
  return (
    <time dateTime={date} title={new Date(date).toLocaleString(i18n.language)}>
      {relative}
    </time>
  )
}

/** Missing texts of a project: a warning link, "complete" or a setup hint. */
function MissingTexts({ project }: { project: OverviewProject }) {
  const { t, i18n } = useTranslation()
  const count = project.missingCount
  const value = count.toLocaleString(i18n.language)
  if (project.keyCount === 0 || project.languageCount === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t(
          project.languageCount === 0
            ? 'overview-page.no-languages'
            : 'overview-page.no-keys'
        )}
      </span>
    )
  }
  if (count === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('overview-page.complete')}
      </span>
    )
  }
  return (
    <Link
      to={projectPath(project.id, 'translations')}
      aria-label={t('overview-page.missing-link', {
        count,
        value,
        project: project.name,
      })}
      className="inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge variant="warning" className="tabular-nums">
        {t('overview-page.missing', { count, value })}
      </Badge>
    </Link>
  )
}

function KpiTile({
  label,
  value,
  icon,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <dt className="text-xs font-medium uppercase tracking-wider">
          {label}
        </dt>
        <span aria-hidden="true">{icon}</span>
      </div>
      <dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function KpiTiles({ counts }: { counts: OverviewData['counts'] }) {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-2 gap-3">
      <KpiTile
        label={t('overview-page.kpi.organizations')}
        value={counts.organizations}
        icon={<Building2 className="h-4 w-4" />}
      />
      <KpiTile
        label={t('overview-page.kpi.projects')}
        value={counts.projects}
        icon={<FolderKanban className="h-4 w-4" />}
      />
    </dl>
  )
}

function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6" aria-busy="true">
      <span role="status" className="sr-only">
        {t('common.loading')}
      </span>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[5.5rem] w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function ProjectsTable({ data }: { data: OverviewData }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const number = (n: number) => n.toLocaleString(i18n.language)

  const columns: DataTableColumn<OverviewProject>[] = [
    {
      key: 'name',
      header: t('overview-page.col-project'),
      cell: (p) => (
        <Link
          to={projectPath(p.id)}
          className="block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="block truncate font-medium">{p.name}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {p.key}
          </span>
        </Link>
      ),
    },
    {
      key: 'org',
      header: t('overview-page.col-organization'),
      hideBelow: 'sm',
      className: 'text-muted-foreground',
      cell: (p) => <span className="block truncate">{p.organizationName}</span>,
    },
    {
      key: 'type',
      header: t('overview-page.col-type'),
      hideBelow: 'md',
      cell: (p) =>
        p.type === 'MULTI' ? (
          <Badge variant="neutral">{t('overview-page.type-multi')}</Badge>
        ) : (
          <Badge variant="outline">{t('overview-page.type-single')}</Badge>
        ),
    },
    {
      key: 'brands',
      header: t('overview-page.col-brands'),
      align: 'right',
      className: 'tabular-nums',
      cell: (p) => p.brandCount,
    },
    {
      key: 'keys',
      header: t('overview-page.col-keys'),
      align: 'right',
      hideBelow: 'sm',
      className: 'tabular-nums',
      cell: (p) => number(p.keyCount),
    },
    {
      key: 'languages',
      header: t('overview-page.col-languages'),
      align: 'right',
      hideBelow: 'lg',
      className: 'tabular-nums',
      cell: (p) => number(p.languageCount),
    },
    {
      key: 'missing',
      header: t('overview-page.col-missing'),
      align: 'right',
      className: 'whitespace-nowrap',
      cell: (p) => <MissingTexts project={p} />,
    },
    {
      key: 'updated',
      header: t('overview-page.col-updated'),
      hideBelow: 'md',
      className: 'whitespace-nowrap text-xs text-muted-foreground',
      cell: (p) => <RelativeTime date={p.updatedAt} />,
    },
  ]

  return (
    <section aria-labelledby="overview-projects" className="space-y-3">
      <h2 id="overview-projects" className="text-sm font-semibold">
        {t('overview-page.projects-title')}
      </h2>
      <DataTable
        columns={columns}
        rows={data.projects}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(projectPath(p.id))}
        rowFocusable={false}
        label={t('overview-page.projects-title')}
        empty={
          <EmptyState
            bordered={false}
            icon={<FolderKanban className="h-5 w-5" />}
            title={t('overview-page.projects-empty')}
            description={t('overview-page.projects-empty-hint')}
            action={
              <Button asChild size="sm" variant="outline">
                <Link to={ROUTES.orgs}>{t('overview-page.go-to-orgs')}</Link>
              </Button>
            }
          />
        }
      />
    </section>
  )
}

/** `/overview`: key figures and all projects of the user. */
export default function OverviewPage() {
  const { t } = useTranslation()
  const { data, error, isLoading, reload } = useOverview()

  const newOrgButton = (
    <Button asChild variant="outline" size="sm">
      <Link to={ROUTES.newOrg}>
        <Plus className="mr-1.5 h-4 w-4" />
        {t('overview-page.new-organization')}
      </Link>
    </Button>
  )

  let content: ReactNode
  if (isLoading && !data) {
    content = <LoadingState />
  } else if (error || !data) {
    content = (
      <ErrorState message={t('overview-page.load-error')} onRetry={reload} />
    )
  } else if (data.counts.organizations === 0) {
    content = (
      <EmptyState
        icon={<Building2 className="h-5 w-5" />}
        title={t('overview-page.no-orgs-title')}
        description={t('overview-page.no-orgs-text')}
        action={
          <Button asChild>
            <Link to={ROUTES.newOrg}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('overview-page.create-org')}
            </Link>
          </Button>
        }
      />
    )
  } else {
    content = (
      <div className="space-y-8">
        <KpiTiles counts={data.counts} />
        <ProjectsTable data={data} />
      </div>
    )
  }

  const hasOrgs = (data?.counts.organizations ?? 0) > 0
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t('overview-page.title')}
        description={t('overview-page.description')}
        actions={hasOrgs ? newOrgButton : undefined}
      />
      {content}
    </div>
  )
}
