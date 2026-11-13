/** Kinds of changes that can affect delivered translations. */
export type ChangeAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'imported'
  | 'languages_changed'
  | 'brand_changed'
  | 'ai_translated'

export interface TranslationChange {
  key?: string
  namespace?: string
  language?: string
  action: ChangeAction
}

/**
 * One debounced notification per project: published on the
 * ChangeBus, consumed by the webhook dispatcher.
 */
export interface TranslationsChangedEvent {
  eventId: string
  organizationId: string
  projectId: string
  projectKey: string
  /** Current configuration version of the project after the changes */
  version: number
  changes: TranslationChange[]
  /** Set when more than MAX_EVENT_CHANGES changes were collected */
  truncated?: boolean
  /** ISO timestamp */
  createdAt: string
}

export interface RecordChangeInput {
  organizationId: string
  projectId: string
  changes: TranslationChange[]
}
