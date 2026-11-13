import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { FAILURE_WARNING_THRESHOLD, type Webhook } from '@/lib/webhooks'

/** Enabled/disabled badge plus the result of the last delivery. */
export function WebhookStatus({ webhook }: { webhook: Webhook }) {
  const { t, i18n } = useTranslation()
  const last = webhook.lastDeliveryAt ? new Date(webhook.lastDeliveryAt).toLocaleString(i18n.language) : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={webhook.enabled ? 'secondary' : 'outline'}>
          {webhook.enabled ? t('webhooks.status.enabled') : t('webhooks.status.disabled')}
        </Badge>
        {webhook.lastStatus === 'success' && (
          <span className="inline-flex items-center gap-1 text-xs text-success" title={last ?? undefined}>
            <CircleCheck className="h-3.5 w-3.5" aria-hidden />
            <span>{t('webhooks.status.last-success')}</span>
            {last && <span className="sr-only"> ({last})</span>}
          </span>
        )}
        {webhook.lastStatus === 'failed' && (
          <span className="inline-flex items-center gap-1 text-xs text-destructive" title={last ?? undefined}>
            <CircleX className="h-3.5 w-3.5" aria-hidden />
            <span>{t('webhooks.status.last-failed')}</span>
            {last && <span className="sr-only"> ({last})</span>}
          </span>
        )}
        {!webhook.lastStatus && <span className="text-xs text-muted-foreground">{t('webhooks.status.never')}</span>}
      </div>
      {webhook.consecutiveFailures >= FAILURE_WARNING_THRESHOLD && (
        <span className="inline-flex items-center gap-1 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('webhooks.status.failures', { count: webhook.consecutiveFailures })}
        </span>
      )}
    </div>
  )
}
