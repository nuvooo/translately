# Translately ohne Environments, Brands als aufklappbare Zeilen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Environments komplett aus Translately entfernen und die Übersetzungs-Tabelle kompakt machen: eine Zeile pro Key, aufklappbar mit einer Zeile je Brand, in der Texte direkt bearbeitet, gelöst und wieder verknüpft werden.

**Architecture:** Ein Text ist Key × Sprache × Scope (`default` oder Brand-Id). Die Tabellen-Abfrage liefert pro Seite Standardtexte plus die Überschreibungen aller Brands; geerbte Werte leitet die Oberfläche selbst ab. Lösen/Verknüpfen liegt in einem eigenen `TranslationLinkService`. Reihenfolge: erst Backend ohne Environments (Tasks 1–4), dann Link-Service (5), dann Oberfläche (6–9), dann Doku (10).

**Tech Stack:** NestJS 11, Prisma 5, MongoDB, Jest · React 19, Vite 8, Tailwind 4, i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-12-ohne-environments-brand-zeilen-design.md` (baut auf `2026-11-11-translately-design.md` auf)

**Arbeitsordner:** `C:\Users\nuVo\Documents\translately`, Branch `build/translately`.

## Global Constraints

- Backend: kein `import type` (bricht NestJS DI); Biome `useImportType: "off"` bleibt.
- Jeder sichtbare Text kommt aus `frontend/src/i18n/locales/de.ts` und `en.ts` (beide pflegen).
- Keine rohen Farben: `npm run lint:colors` bleibt grün; vorhandene `components/ui/*` verwenden.
- VIEWER sieht alles schreibgeschützt, auch die Brand-Zeilen (kein Lösen/Verknüpfen).
- Ein leerer Text wird nie gespeichert.
- Kein Umstellungs-Skript, keine Weiterleitung des alten Auslieferungs-Pfads, kein Code, der Datenbanken leert.
- Conventional Commits; jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
- Prüfbefehle: `cd backend && npm run build && npm test` · `cd frontend && npm run build && npm test && npm run lint:colors` · im Root `npm run biome:check`.
- Zwischen Task 1 und Task 4 darf der Backend-Build rot sein; jeder Task nennt, was am Ende grün sein muss. Ab Task 4 ist das Backend vollständig grün, ab Task 9 das Frontend.

## Review Focus

- **Brand bietet eine Sprache nicht an:** Zelle in der Brand-Zeile ist gesperrt; Schreiben, Lösen und Verknüpfen dafür lehnt das Backend mit 400 ab (Task 2, 5, 8).
- **Standardtext ändert sich, während Brand-Zeilen offen sind:** geerbte Brand-Zellen zeigen sofort den neuen Standardtext, gelöste bleiben unverändert (Task 7).
- **Lösen bei leerem Standardtext:** nichts wird gespeichert, die Zelle öffnet sich nur zum Schreiben (Task 5, 8).
- **Schnelles Klicken auf Lösen/Verknüpfen derselben Zelle und Speichern schlägt fehl:** die Zelle zeigt am Ende den Stand des Servers, nichts geht still verloren (Task 7).
- **Projekt ohne Brands oder Single-Brand:** kein Pfeil, keine Legende, keine Ziel-Auswahl in den Dialogen (Task 8, 9).

---

### Task 1: Schema, Environments-Modul, Zugriff, Change-Events

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/src/app.module.ts`
- Delete: `backend/src/modules/environments/` (ganzer Ordner), `backend/src/shared/environment-sort-order.migration.ts` und `.spec.ts`
- Modify: `backend/src/shared/prisma.service.ts` (+ `.spec.ts`), `backend/src/shared/access/access.service.ts`
- Modify: `backend/src/modules/change-events/change-events.types.ts`, `change-events.service.ts`, `change-bus.ts` und deren Specs

**Interfaces – Produces:**
- Prisma: `Environment` und alle Relationen darauf entfernt. `TranslationValue` ohne `environmentId`, `@@unique([keyId, language, scope])` (Prisma-Name `keyId_language_scope`), `@@index([projectId, language, scope])`. `ApiKey` ohne `environmentId`. `Webhook` ohne `environmentIds`. `ConfigVersion`: `projectId String @unique @db.ObjectId`, kein `environmentId`.
- `RecordChangeInput = { organizationId: string; projectId: string; changes: TranslationChange[] }`
- `TranslationsChangedEvent` ohne `environmentId`/`environmentKey`; `version` ist die Version des Projekts.
- `ChangeAction` ohne `'copied'` und `'environment_changed'`.
- `ChangeEventsService.getVersion(projectId: string): Promise<number>`; `recordChange(input: RecordChangeInput)` erhöht genau einen Zähler und puffert pro Projekt.
- `AccessService`: `assertEnvironmentAccess` und `assertEnvironmentInProject` entfernt.

- [ ] **Step 1:** Specs von `change-events.service` umschreiben: `recordChange({ organizationId, projectId, changes })` erhöht `getVersion(projectId)` um genau 1; zwei Aufrufe innerhalb des Sammelfensters ergeben **ein** Event mit beiden Changes und ohne die Felder `environmentId`/`environmentKey` (`expect(event).not.toHaveProperty('environmentId')`). `change-bus.spec`: ein Event ohne `environmentId` ist gültig.
- [ ] **Step 2:** `cd backend && npx jest change-events change-bus` → FAIL.
- [ ] **Step 3:** Schema wie oben ändern, `npx prisma generate`. `seed.ts` ohne Environments.
- [ ] **Step 4:** Ordner und Migration löschen; `EnvironmentsModule` aus `app.module.ts`; in `prisma.service.ts` den Aufruf `runEnvironmentSortOrderMigration` samt Methode und den Raw-Zugriff auf `environments` entfernen, Spec anpassen.
- [ ] **Step 5:** Change-Events nach den Interfaces oben umbauen; die beiden Methoden aus `access.service.ts` löschen.
- [ ] **Step 6:** `npx jest change-events change-bus prisma.service access` → PASS. (Der Gesamt-Build ist noch rot.)
- [ ] **Step 7:** Commit `refactor(backend): drop the environment model and per-environment versions`.

### Task 2: Texte ohne Environment, Tabelle mit Überschreibungen

**Files:**
- Modify: `backend/src/modules/translations/translations.service.ts`, `translations.controller.ts`, `translations.module.ts`, `limits.ts`
- Modify: `dto/table-query.dto.ts`, `dto/set-value.dto.ts`, `dto/import.dto.ts`
- Modify: `translation-import.service.ts`, `translation-bulk-writer.ts`, `translation-files.service.ts`, `translation-settings.service.ts`, `testing/fake-raw-value-update.ts`
- Delete: `translation-copy.service.ts`, `.spec.ts`, `dto/copy.dto.ts`
- Test: die jeweiligen `.spec.ts`, inkl. `import-body-parser.spec.ts`

**Interfaces – Consumes:** Task 1.

**Interfaces – Produces:**
```ts
// translations.service.ts
export interface TableRow {
  keyId: string
  key: string
  description: string | null
  /** Standardtexte je Spalte; `inherited` ist hier immer false. */
  values: Record<string, TableCell>
  /** brandId -> Sprache -> eigener Text. Nur Brands mit mindestens einem Eintrag. */
  overrides: Record<string, Record<string, string>>
}
export interface TableQuery { namespace?: string; search?: string; missingOnly?: boolean; page?: number; pageSize?: number }
getTable(projectId: string, query: TableQuery): Promise<TranslationTable>
setValue(keyId: string, userId: string, dto: { language: string; brandId?: string; value: string }): Promise<TableCell>
```
- `TranslationTable.languages` = Projektsprachen, danach in Reihenfolge des ersten Auftretens die Sprachen, die nur Brands anbieten (Brands nach Name sortiert). Bei `SINGLE` nur Projektsprachen und `overrides` immer `{}`.
- `overrides` enthält nur Sprachen, die in der Sprachliste der jeweiligen Brand stehen.
- `missingOnly`: Zeile bleibt, wenn in mindestens einer **Projektsprache** der Standardtext fehlt. `search`: trifft Key, Standardtexte oder irgendeine Überschreibung.
- Standardzelle einer Nicht-Projektsprache: `setValue` ohne `brandId` → 400 wie bisher („not enabled for this view“).
- Routen `translations/copy` und `translations/copy/preview` gibt es nicht mehr. `ImportTargetDto`/`ExportQueryDto`/`ImportTarget`: `{ language, namespace?, brandId? }`.

- [ ] **Step 1:** Tests in `translations.service.spec.ts` (bestehende Fälle auf die neue Signatur umstellen, dazu neu):
  - `getTable` MULTI, Projekt `['de','en']`, Brand A `['de','fr']` mit Überschreibung `de`, Brand B ohne: `languages` ist `['de','en','fr']`; `rows[0].overrides` ist `{ [brandA]: { de: 'A-Text' } }`; `rows[0].values.fr` ist `{ value: null, inherited: false }`.
  - Überschreibung in einer Sprache, die nicht (mehr) in der Brand-Liste steht, fehlt in `overrides`.
  - `search` findet eine Zeile, deren einziger Treffer in einer Überschreibung liegt.
  - `missingOnly`: Zeile mit vollständigen Standardtexten, aber fehlendem `fr`, wird **nicht** geliefert.
  - `setValue` schreibt/löscht über `keyId_language_scope`; ein Aufruf erzeugt genau ein `recordChange` ohne Environment.
- [ ] **Step 2:** `npx jest translations.service` → FAIL.
- [ ] **Step 3:** `getTable` und `setValue` umbauen. `getTable` bleibt bei zwei Abfragen plus einer für die Brands (kein N+1): Werte mit `scope in [default, ...brandIds]`.
- [ ] **Step 4:** Controller: `environmentId`-Prüfungen, `brandId` aus der Tabellen-Abfrage und die Copy-Routen samt `assertCopyAccess` entfernen; `TranslationCopyService` aus dem Modul; DTOs anpassen (`TARGET_FIELDS = ['language','namespace','brandId']`); Copy-Limit aus `limits.ts`.
- [ ] **Step 5:** Import, Bulk-Writer, Files-, Settings-Service und ihre Specs: `environmentId` überall entfernen; `recordChange` ohne `environmentIds`. Im Bulk-Writer ist die eindeutige Zeile (Key, Sprache, Scope).
- [ ] **Step 6:** `npx jest modules/translations` → PASS; `grep -rin environment backend/src/modules/translations` → nur noch `translations-delivery*` (Task 3).
- [ ] **Step 7:** Commit `refactor(translations): store texts once per project and return brand overrides with the table`.

### Task 3: Auslieferung und API-Keys

**Files:**
- Modify: `backend/src/modules/translations/translations-delivery.ts` (+ Spec), `backend/src/modules/sdk/sdk.service.ts`, `sdk-etag.ts`, `sdk-http.utils.ts`, `sdk.constants.ts` (+ Specs), `backend/src/modules/api-keys/api-keys.service.ts` (+ Spec), `backend/src/main.ts`

**Interfaces – Produces:**
- Route `GET /sdk/translations/:projectKey/:lng/:ns`, Brand weiter über `?brandKey=`. Der alte Pfad mit vier Segmenten antwortet 404.
- `SdkService.resolveSdkAccess(...)` ohne Parameter `environmentKey`, Ergebnis ohne `environment`; die Prüfung „API key is bound to another environment“ entfällt.
- ETag-Scope: `{ organizationId, projectId }` plus `getVersion(projectId)`.
- `SDK_ERROR_CODES.environmentNotFound` und der zugehörige Zweig in `sdk-http.utils.ts` entfallen. API-Key-Antworten ohne `environmentId`.

- [ ] **Step 1:** Specs: `translations-delivery.spec` ruft den neuen Pfad auf; Standard-Datei, Brand-Datei (eigener Text überlagert Standard), Brand ohne die Sprache → `{}`; zweiter Abruf mit `If-None-Match` → 304; nach `recordChange` für das Projekt neues ETag. `sdk.service.spec`: Key der Organisation erhält Zugriff ohne Environment-Angabe.
- [ ] **Step 2:** `npx jest sdk translations-delivery api-keys` → FAIL.
- [ ] **Step 3:** Umsetzen; OpenAPI-Eintrag in `main.ts` auf `/sdk/translations/{projectKey}/{lng}/{ns}` ohne Parameter `environmentKey` und ohne die 404-Beschreibung „Environment not found“.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `refactor(delivery): serve translations per project without an environment segment`.

### Task 4: Restliche Module, Backend grün

**Files:**
- Modify: `backend/src/modules/projects/projects.service.ts`, `projects.controller.ts`, `modules/organizations/organizations.service.ts`, `modules/auth/setup.controller.ts`, `modules/brands/brands.service.ts`, `modules/overview/overview.service.ts`, `modules/audit-logs/*` (nur Spec), jeweils mit Specs
- Modify: `backend/src/modules/webhooks/dto/webhook.dto.ts`, `webhooks.service.ts`, `webhook-dispatcher.ts`, `webhook-payload.ts`, `testing/fake-webhook-prisma.ts` und Specs

**Interfaces – Produces:**
- Projekt-Antworten ohne `environments`/`environmentCount`; Route `GET projects/:id/environments` entfernt; beim Anlegen eines Projekts und beim Setup entstehen keine Environments.
- Overview pro Projekt ohne `environmentCount`; `missing = Keys × Projektsprachen − vorhandene Standardtexte in Projektsprachen`.
- Webhook-DTOs ohne `environmentIds`, `WEBHOOK_MAX_ENVIRONMENTS` entfällt, Fehlercode `environment_not_in_project` und Audit-Aktion `webhook.disabled_environment_deleted` entfallen. Der Dispatcher stellt jedem aktiven Webhook des Projekts zu. Payload ohne Feld `environment`.

- [ ] **Step 1:** Specs anpassen bzw. ergänzen: Overview – 3 Keys, Sprachen `['de','en']`, 4 Standardtexte → `missing` ist 2, ein Text in einer Nicht-Projektsprache zählt nicht. Dispatcher – ein Event erreicht alle aktiven Webhooks des Projekts und keinen eines anderen Projekts. Payload – `expect(payload).not.toHaveProperty('environment')`. Projekt anlegen – kein Zugriff auf `prisma.environment`.
- [ ] **Step 2:** Umsetzen.
- [ ] **Step 3:** `cd backend && npm run build && npm test` → grün. `grep -rin "environment" backend/src backend/prisma | grep -vi "process.env\|NODE_ENV\|environment variable"` → keine Treffer.
- [ ] **Step 4:** Commit `refactor(backend): remove environments from projects, overview and webhooks`.

### Task 5: Link/Unlink-Service

**Files:**
- Create: `backend/src/modules/translations/translation-link.service.ts`, `translation-link.service.spec.ts`, `dto/link.dto.ts`
- Modify: `translations.controller.ts` (+ Spec), `translations.module.ts`

**Interfaces – Produces:**
```ts
@Injectable() export class TranslationLinkService {
  /** Überschreibung mit dem aktuellen Standardtext anlegen. */
  unlink(keyId: string, userId: string, target: { brandId: string; language: string }): Promise<TableCell>
  /** Überschreibung löschen; die Brand erbt wieder. */
  link(keyId: string, userId: string, target: { brandId: string; language: string }): Promise<TableCell>
}
// dto/link.dto.ts
export class LinkDto { language: string }   // gleiche Validierung wie SetValueDto.language
```
- Routen: `POST translation-keys/:keyId/brands/:brandId/unlink` und `.../link`, Body `LinkDto`, Antwort `{ cell: TableCell }`, HTTP 200. Rechte: `assertTranslationKeyAccess(..., 'MEMBER')` und `assertBrandInProject(brandId, key.projectId)`.
- Audit-Aktionen `translation.value_unlinked` / `translation.value_linked`, `entityType: 'TranslationKey'`, `newValues`/`oldValues` mit `{ language, scope: brandId, value }`.

- [ ] **Step 1:** Tests in `translation-link.service.spec.ts`:
  - `unlink` mit Standardtext `'Hallo'` → legt Wert mit `scope = brandId` an, gibt `{ value: 'Hallo', inherited: false }`, ein `recordChange`, ein Audit-Eintrag.
  - `unlink`, wenn die Überschreibung schon existiert (`'Eigen'`) → gibt `{ value: 'Eigen', inherited: false }`, schreibt nichts, kein `recordChange`.
  - `unlink` ohne Standardtext → `{ value: null, inherited: false }`, nichts geschrieben.
  - `link` mit Überschreibung → gelöscht, gibt `{ value: 'Hallo', inherited: true }`; ohne Standardtext `{ value: null, inherited: false }`.
  - `link` ohne Überschreibung → gleiche Antwort, nichts geschrieben, kein `recordChange`.
  - Sprache nicht in der Brand-Liste → `BadRequestException` bei beiden. Projekt `SINGLE` → `BadRequestException`.
  - Sprache in der Brand-Liste, aber keine Projektsprache: `link` gibt `{ value: null, inherited: false }` (es gibt nichts zu erben).
- [ ] **Step 2:** `npx jest translation-link` → FAIL.
- [ ] **Step 3:** Service umsetzen. Gemeinsame Hilfen (`loadKey`, Projekt/Brand laden, Audit) nicht kopieren: was `TranslationsService` schon privat hat und hier gebraucht wird, in eine kleine exportierte Hilfsdatei `translation-context.ts` im selben Ordner ziehen und von beiden nutzen.
- [ ] **Step 4:** Controller-Routen + Controller-Spec (403 für VIEWER, 404 für Brand eines anderen Projekts).
- [ ] **Step 5:** `npm run build && npm test` → grün.
- [ ] **Step 6:** Commit `feat(translations): link and unlink brand texts`.

### Task 6: Oberfläche ohne Environments (alles außer der Übersetzungs-Seite)

**Files:**
- Delete: `frontend/src/pages/projects/environments/` (ganzer Ordner), `frontend/src/components/webhooks/EnvironmentSelect.tsx`
- Modify: `frontend/src/App.tsx`, `lib/routes.ts` (+ Test), `components/shell/ContextNav.tsx`, `CommandPalette.tsx` (+ `ContextNav.test.tsx`, `Rail.test.tsx`: auf `/projects/p1/brands` umstellen)
- Modify: `lib/webhooks.ts` (+ Test), `components/webhooks/WebhookFormDialog.tsx`, `WebhookActions.tsx`, `WebhookStatus.tsx`, `pages/projects/Webhooks.tsx`, `WebhookDetail.tsx` (+ Tests)
- Modify: `pages/orgs/api-keys/apiKeys.ts`, `ApiKeysPage.tsx` (+ Test), `pages/orgs/audit-log/auditLog.ts` (+ Test), `pages/orgs/projects/OrgProjectsPage.tsx` (+ Test), `pages/overview/overview.ts`, `OverviewPage.tsx` (+ Test), `pages/projects/settings/project.ts`
- Modify: `frontend/src/i18n/locales/de.ts`, `en.ts`

**Vorgaben:**
- Route, Menüpunkt und Command-Palette-Eintrag „Environments“ weg.
- Webhooks: keine Environment-Auswahl, keine Environment-Spalte, kein `environmentIds` in Requests.
- API-Keys: Spalte „Environment“ und das Nachladen der Environment-Namen weg.
- Audit-Log: die vier `environment.*`-Aktionen, die Gruppe `environment.` und `webhook.disabled_environment_deleted` weg.
- Org-Projekte und Overview: Spalte für Environments weg.
- Locale-Schlüssel löschen: `nav.environments`, `environments-page.*`, `overview-page.col-environments`, `org-pages.projects.col-environments`, `org-pages.api-keys.col-environment`, `org-pages.audit.group.environment`, `org-pages.audit.action.environment-*`, `org-pages.audit.action.webhook-disabled_environment_deleted`, `webhooks.col-environments`, `webhooks.form.environments`, `webhooks.form.all-environments`, `webhooks.form.environments-hint`, `webhooks.error.environment_not_in_project`. (`translations.*` folgt in Task 9.)

- [ ] **Step 1:** Tests anpassen: `routes.test` – `'environments'` ist kein Projektbereich mehr; `Webhooks.test` – das Formular hat kein Feld mit dem Namen „Environments“ und der Create-Request enthält kein `environmentIds`; `ApiKeysPage.test` – keine Spaltenüberschrift „Environment“; `OverviewPage.test`/`OrgProjectsPage.test` entsprechend.
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib src/pages/orgs src/pages/overview src/pages/projects/Webhooks.test.tsx src/pages/projects/WebhookDetail.test.tsx src/components/shell` → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Dieselben Tests → PASS. (`npm run build` ist wegen der Übersetzungs-Seite noch rot.)
- [ ] **Step 5:** Commit `refactor(frontend): remove environments outside the translations page`.

### Task 7: Daten-Schicht der Übersetzungs-Seite

**Files:**
- Modify: `frontend/src/pages/projects/translations/types.ts`, `api.ts`, `translationsState.ts`, `useTranslations.ts`, `deliveryUrl.ts`
- Test: `api.test.ts`, `useTranslations.test.tsx`, `deliveryUrl.test.ts`, neu `translationsState.test.ts`

**Interfaces – Produces:**
```ts
// types.ts
export interface TableRow { keyId: string; key: string; description: string | null
  values: Record<string, TableCell>; overrides: Record<string, Record<string, string>> }
export interface TableQuery { namespace?: string; search?: string; missingOnly?: boolean; page?: number; pageSize?: number }
export interface ImportTarget { language: string; namespace?: string; brandId?: string }
// CopyPreview entfällt

// api.ts
setValue(keyId: string, body: { language: string; brandId?: string; value: string }): Promise<TableCell>
unlinkValue(keyId: string, brandId: string, language: string): Promise<TableCell>
linkValue(keyId: string, brandId: string, language: string): Promise<TableCell>
// previewCopy / applyCopy entfallen

// translationsState.ts
export interface Structure { project: TranslationsProject; brands: TranslationsBrand[] }   // kein environments
export const scopeOf = (s: TranslationsSelection) => s.namespace
export const viewOf  = (s: TranslationsSelection) => [s.namespace, s.page].join('|')
export function toQuery(selection: TranslationsSelection): TableQuery
/** Zelle einer Brand-Zeile; null = die Brand bietet die Sprache nicht an. */
export function brandCell(row: TableRow, brand: { id: string; languages: string[] },
  language: string, projectLanguages: string[]): TableCell | null
/** Zahl der Brands (aus `brands`), die für diese Zeile mindestens einen eigenen Text haben. */
export function ownBrandCount(row: TableRow, brands: { id: string }[]): number
/** Setzt (string) oder entfernt (null) eine Überschreibung; gleiche Tabelle zurück, wenn sich nichts ändert. */
export function withOverride(table: TranslationTable, keyId: string, brandId: string,
  language: string, value: string | null): TranslationTable

// useTranslations.ts
export interface TranslationsSelection { namespace: string; search: string; missingOnly: boolean; page: number }
export function cellKey(keyId: string, language: string, brandId?: string | null): string  // `${keyId}:${language}:${brandId ?? 'default'}`
// Rückgabe des Hooks: `environments` entfällt; neu/geändert:
saveValue(row: TableRow, language: string, value: string, brandId?: string | null): Promise<boolean>
unlink(row: TableRow, language: string, brandId: string): Promise<boolean>
relink(row: TableRow, language: string, brandId: string): Promise<boolean>
// resetToInherited entfällt (ersetzt durch relink)

// deliveryUrl.ts: gleicher Funktionsname wie heute, ohne Parameter environmentKey
// Ergebnis: `${base}/sdk/translations/${projectKey}/{{lng}}/{{ns}}` (+ `?brandKey=` wie bisher)
```
- `brandCell`: Sprache nicht in `brand.languages` → `null`; eigener Text → `{ value, inherited: false }`; sonst, wenn Projektsprache und Standardtext vorhanden → `{ value: standard, inherited: true }`; sonst `EMPTY_CELL`.
- `saveValue` mit `brandId`: optimistisch über `withOverride` (`''` entfernt), nach Antwort Stand des Servers: `cell.inherited || cell.value === null` → Überschreibung entfernen, sonst setzen. Reihenfolge überlappender Saves, `busy`, Scope-Prüfung und Fehler-Toast wie bisher, Schlüssel der Saves `${scope}|${cellKey(keyId, language, brandId)}`.
- `unlink`/`relink` laufen durch dieselbe Reihenfolge-Logik wie `saveValue` (gleicher Save-Eintrag pro Zelle), nur mit `unlinkValue`/`linkValue` als Request. `unlink` schreibt optimistisch den Standardtext als Überschreibung; ist der Standardtext leer, wird kein Request gesendet und `true` zurückgegeben.
- `fetchStructure` lädt keine Environments mehr; die Tabelle lädt, sobald das Projekt da ist.

- [ ] **Step 1:** `translationsState.test.ts`: je ein Test pro Zweig von `brandCell` (vier Zweige oben); `ownBrandCount` zählt eine Brand mit leerem Objekt nicht und ignoriert Ids, die nicht in `brands` stehen; `withOverride` – setzen, entfernen (leeres Brand-Objekt wird aus `overrides` entfernt), unverändert gibt dieselbe Tabellen-Identität zurück.
- [ ] **Step 2:** `useTranslations.test.tsx` umstellen (keine Environment-Mocks) und ergänzen:
  - Brand-Save: `saveValue(row, 'de', 'Neu', 'b1')` → Request-Body `{ language: 'de', brandId: 'b1', value: 'Neu' }`, danach `table.rows[0].overrides.b1.de === 'Neu'`.
  - Standard-Save ändert `values.de`, `overrides` bleibt unberührt (damit `brandCell` für geerbte Zellen den neuen Text liefert).
  - `relink` → `linkValue` aufgerufen, Überschreibung weg. `unlink` bei Standardtext `'Hallo'` → `unlinkValue` aufgerufen, Überschreibung `'Hallo'`. `unlink` bei fehlendem Standardtext → kein Request.
  - `unlink` schlägt fehl (500) → Überschreibung wieder weg, Toast, Rückgabe `false`.
  - `unlink` und sofort `relink` derselben Zelle, Antworten in umgekehrter Reihenfolge → am Ende keine Überschreibung.
  - `isBusy(cellKey(keyId, 'de', 'b1'))` ist während des Requests true, `isBusy(cellKey(keyId, 'de'))` nicht.
- [ ] **Step 3:** `api.test.ts`: `fetchTable` sendet kein `environmentId`/`brandId`; `unlinkValue('k','b','de')` → `POST /translation-keys/k/brands/b/unlink` mit `{ language: 'de' }`; `linkValue` analog. `deliveryUrl.test.ts`: URL ohne Environment-Segment.
- [ ] **Step 4:** `npx vitest run src/pages/projects/translations/translationsState.test.ts src/pages/projects/translations/useTranslations.test.tsx src/pages/projects/translations/api.test.ts src/pages/projects/translations/deliveryUrl.test.ts` → FAIL.
- [ ] **Step 5:** Umsetzen.
- [ ] **Step 6:** Dieselben Tests → PASS.
- [ ] **Step 7:** Commit `refactor(translations-ui): data layer without environments, with brand overrides`.

### Task 8: Tabelle mit aufklappbaren Brand-Zeilen

**Files:**
- Modify: `frontend/src/pages/projects/translations/TranslationsTable.tsx`, `TranslationCell.tsx` (+ `TranslationCell.test.tsx`)
- Create: `frontend/src/pages/projects/translations/BrandRows.tsx`, `TranslationsTable.test.tsx`
- Modify: `frontend/src/i18n/locales/de.ts`, `en.ts`

**Interfaces – Consumes:** `brandCell`, `ownBrandCount`, `cellKey` aus Task 7.

**Interfaces – Produces:**
```ts
// TranslationsTable.tsx
interface TranslationsTableProps {
  table: TranslationTable
  /** Brands eines MULTI-Projekts; leer = keine Pfeile, keine Legende. */
  brands: { id: string; name: string; languages: string[] }[]
  projectLanguages: string[]
  readOnly: boolean
  isBusy(cell: string): boolean
  onSave(row: TableRow, language: string, value: string, brandId?: string | null): Promise<boolean>
  onUnlink(row: TableRow, language: string, brandId: string): Promise<boolean>
  onRelink(row: TableRow, language: string, brandId: string): void
  onRename(row: TableRow): void
  onDelete(row: TableRow): void
  onPage(page: number): void
  canDelete?: boolean
}
// BrandRows.tsx – rendert die <tr> aller Brands zu einer Key-Zeile
export const BrandRows: React.MemoExoticComponent<(props: {
  id: string                         // DOM-Id-Präfix, Ziel von aria-controls des Pfeils
  row: TableRow
  languages: string[]                // Spalten der Tabelle
  projectLanguages: string[]
  brands: { id: string; name: string; languages: string[] }[]
  readOnly: boolean
  isBusy(cell: string): boolean
  onSave(row: TableRow, language: string, value: string, brandId: string): Promise<boolean>
  onUnlink(row: TableRow, language: string, brandId: string): Promise<boolean>
  onRelink(row: TableRow, language: string, brandId: string): void
}) => JSX.Element>

// TranslationCell.tsx – neue/ersetzte Props
variant: 'standard' | 'brand'      // ersetzt brandView
onUnlink?(): Promise<boolean>       // brand + geerbt: Ketten-Knopf
onReset?(): void                    // brand + eigen: „wieder verknüpfen“ (wie heute)
/** Gesperrte Zelle mit Tooltip-Text; rendert kein Bearbeiten. */
lockedHint?: string
```
- Erste Spalte: bei `brands.length > 0` ein Pfeil-Button (`ChevronRight`, gedreht wenn offen) vor dem Key, `aria-expanded`, `aria-controls` auf die Brand-Zeilen, Name `translations.row.expand`/`collapse`. Daneben, wenn `ownBrandCount > 0`, ein unauffälliger Hinweis (`badge` Variante outline/secondary) mit `translations.row.own-count`.
- Aufgeklappt: je Brand ein `<tr>` mit `bg-muted/40`, kleinerer Zeilenhöhe; Brandname eingerückt (`pl-9`) in der sticky Key-Spalte als `<th scope="row">`; letzte Spalte (Menü) leer.
- Brand-Zelle: `brandCell(...) === null` → `lockedHint = t('translations.cell.unavailable')`. Standardzelle in einer Spalte, die keine Projektsprache ist → `lockedHint = t('translations.cell.not-project-language')`.
- Ketten-Knopf einer geerbten Zelle: ruft `onUnlink`; bei `true` öffnet sich der Editor der Zelle mit dem dann eigenen Text. Bei leerem Standardtext gibt es keinen Ketten-Knopf (die Zelle zeigt „fehlt“ und ist normal beschreibbar).
- Aufgeklappt-Zustand: `useState<ReadonlySet<string>>` in `TranslationsTable`, zurückgesetzt, wenn sich `table.page` ändert (Namespace-Wechsel remountet die Tabelle über `key` schon heute). Mehrere Zeilen gleichzeitig offen.
- `LinkLegend` erscheint, wenn `brands.length > 0`.
- Tabellenbreite unverändert berechnet; Brand-Zeilen fügen keine Spalten hinzu.
- Locale-Schlüssel (de / en):
  - `translations.row.expand`: „Brands für {{key}} anzeigen“ / “Show brands for {{key}}”
  - `translations.row.collapse`: „Brands für {{key}} ausblenden“ / “Hide brands for {{key}}”
  - `translations.row.own-count_one`: „{{count}} Brand mit eigenem Text“ / “{{count}} brand with its own text”
  - `translations.row.own-count_other`: „{{count}} Brands mit eigenen Texten“ / “{{count}} brands with their own texts”
  - `translations.cell.brand-label`: „{{key}} – {{language}} – {{brand}}“ (beide)
  - `translations.cell.unlink`: „Lösen: {{label}}“ / “Unlink: {{label}}”
  - `translations.cell.unavailable`: „Die Brand bietet diese Sprache nicht an“ / “The brand does not offer this language”
  - `translations.cell.not-project-language`: „Keine Projektsprache – hier haben nur Brands Texte“ / “Not a project language – only brands have texts here”

- [ ] **Step 1:** `TranslationsTable.test.tsx` (Tabelle mit 2 Keys, Sprachen `['de','en','fr']`, Projektsprachen `['de','en']`, Brand „Alpha“ `['de','fr']` mit Überschreibung `de` für Key 1, Brand „Beta“ `['de']`):
  - zugeklappt: keine Zeile „Alpha“; Key 1 zeigt „1 Brand mit eigenem Text“, Key 2 keinen Hinweis.
  - Klick auf den Pfeil von Key 1: `aria-expanded="true"`, Zeilen „Alpha“ und „Beta“ sichtbar; Key 2 bleibt zu.
  - Alpha/`de` zeigt den eigenen Text mit Knopf „Wieder verknüpfen: …“; Klick ruft `onRelink(row, 'de', alphaId)`.
  - Beta/`de` zeigt den Standardtext mit „Aus dem Standard übernommen“ und Knopf „Lösen: …“; Klick ruft `onUnlink(row, 'de', betaId)`, danach ist ein Textfeld mit dem Standardtext offen.
  - Beta/`en` ist gesperrt (kein Button mit dem Zell-Label, Tooltip-Text vorhanden).
  - Standardzelle `fr` ist gesperrt.
  - In Alpha/`fr` tippen und Enter → `onSave(row, 'fr', 'Bonjour', alphaId)`.
  - `brands=[]`: kein Pfeil-Button, keine Legende.
  - `readOnly`: Brand-Zeilen sichtbar, aber keine Knöpfe „Lösen“/„Wieder verknüpfen“ und keine editierbaren Zellen.
  - `rerender` mit `table.page = 2`: alle Zeilen wieder zugeklappt.
  - Pfeil per Tastatur: Fokus + Enter klappt auf.
- [ ] **Step 2:** `TranslationCell.test.tsx` auf `variant` umstellen; neu: `lockedHint` rendert keinen Button; `onUnlink` mit Rückgabe `false` öffnet den Editor nicht.
- [ ] **Step 3:** `npx vitest run src/pages/projects/translations/TranslationsTable.test.tsx src/pages/projects/translations/TranslationCell.test.tsx` → FAIL.
- [ ] **Step 4:** Umsetzen; `Row` und `BrandRows` bleiben memoisiert (ein Save in einer Zeile rendert die anderen nicht neu).
- [ ] **Step 5:** Tests → PASS; `npm run lint:colors` → grün.
- [ ] **Step 6:** Commit `feat(translations-ui): expandable brand rows with link and unlink`.

### Task 9: Seite, Toolbar und Dialoge

**Files:**
- Modify: `frontend/src/pages/projects/translations/TranslationsPage.tsx`, `TranslationsToolbar.tsx`, `TranslationsDialogs.tsx`, `ImportDialog.tsx`, `ExportButton.tsx`, `DeliverySnippet.tsx`, `LanguagesDialog.tsx` und ihre Tests
- Create: `frontend/src/pages/projects/translations/TargetSelect.tsx`
- Delete: `CopyDialog.tsx`, `CopyDialog.test.tsx`
- Modify: `frontend/src/i18n/locales/de.ts`, `en.ts`

**Interfaces – Produces:**
```ts
// TargetSelect.tsx – „Standard“ plus alle Brands; rendert nichts bei brands.length === 0
export function TargetSelect(props: {
  brands: { id: string; name: string }[]
  value: string | null                 // null = Standard
  onChange(brandId: string | null): void
  disabled?: boolean
}): JSX.Element | null
```
- **Toolbar:** eine Zeile: Namespace-Auswahl (nur bei > 1), Suche, Schalter „nur fehlende“, rechts die Aktionen. Environment-Tabs, `environmentTabId`, `panelId` und die Brand-Auswahl entfallen; der Tabellenbereich ist ein normales `div` mit `aria-busy` (kein `role="tabpanel"`).
- **Seite:** kein leerer Zustand „keine Environments“; kein `CopyButton`. Übergibt der Tabelle `brands` (nur bei `project.type === 'MULTI'`, sonst `[]`), `projectLanguages`, `onUnlink`, `onRelink`. „Keine Sprachen“ gilt, wenn `project.languages` leer ist **und** keine Brand Sprachen hat.
- **Dialoge mit Ziel-Auswahl** (jeweils `TargetSelect` oben im Dialog, Startwert Standard; die Sprachliste folgt dem Ziel: Projektsprachen bzw. Sprachen der Brand):
  - `ImportDialog`: Props `brands` statt `environment`/`brand`; die Zeile „Environment“ in der Zusammenfassung entfällt; Zielwechsel verwirft eine schon erstellte Vorschau.
  - `ExportButton`: Props `projectId, brands, projectLanguages, namespace, disabled`. Im Menü zuerst eine `DropdownMenuRadioGroup` „Standard / Brand“ (nur bei Brands), darunter die Sprachen des gewählten Ziels.
  - `DeliverySnippet`: Props `projectKey, brands (mit key), projectLanguages, organizationId`; Snippet folgt dem gewählten Ziel.
  - „Sprachen verwalten“: `TargetSelect` im `LanguagesDialog`-Kopf, gesteuert von der Seite (`scope` wird aus dem gewählten Ziel gebildet); Zielwechsel ist nur möglich, solange der Entwurf unverändert ist (sonst `disabled`).
- Locale: löschen `translations.no-environments-*`, `translations.toolbar.environments`, `translations.toolbar.brand`, `translations.toolbar.standard`, `translations.import-dialog.environment`, `translations.copy.*`. Ändern: `translations.snippet.scope` → „Konfiguration für die Standardtexte.“ / “Configuration for the default texts.”; `translations.snippet.scope-brand` → „Konfiguration für die Brand „{{brand}}“.“ / “Configuration for the brand “{{brand}}”.” Neu: `translations.target.label` „Ziel“ / “Target”, `translations.target.standard` „Standard“ / “Default”.

- [ ] **Step 1:** Tests:
  - `TranslationsPage.test.tsx`: keine Tabs (`queryByRole('tablist')` ist null), kein Knopf „Kopieren“, keine Brand-Auswahl in der Toolbar; MULTI-Projekt mit Brand → Pfeil-Buttons vorhanden; SINGLE → keine; Projekt ohne Projektsprachen, aber Brand mit Sprachen → Tabelle statt „keine Sprachen“.
  - `ImportDialog.test.tsx`: Ziel „Alpha“ wählen → Preview-Request enthält `brandId` und kein `environmentId`; Sprachauswahl zeigt die Sprachen von Alpha; ohne Brands kein Ziel-Feld.
  - `ExportButton.test.tsx`: Ziel Brand → Export-Request mit `brandId`; ohne Brands keine Radio-Gruppe.
  - `DeliverySnippet.test.tsx`: Snippet enthält `/sdk/translations/<projectKey>/{{lng}}/{{ns}}`, mit Brand zusätzlich `brandKey=`; das Wort „Environment“ kommt nicht vor.
  - `LanguagesDialog.test.tsx`: Zielwechsel bei geändertem Entwurf ist gesperrt.
- [ ] **Step 2:** `npx vitest run src/pages/projects/translations` → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** `cd frontend && npm run build && npm test && npm run lint:colors` → grün; im Root `npm run biome:check` → grün. `grep -rin "environment" frontend/src | grep -vi "import.meta.env"` → keine Treffer.
- [ ] **Step 5:** Im Browser prüfen (Skill `run`): MULTI-Projekt mit zwei Brands anlegen, Key anlegen, Zeile aufklappen, Brand-Text ändern, verknüpfen, lösen; Auslieferungs-URL aus dem Snippet mit und ohne `brandKey` abrufen und die Werte vergleichen.
- [ ] **Step 6:** Commit `feat(translations-ui): compact page without environment tabs and brand picker`.

### Task 10: Doku

**Files:**
- Modify: `README.md`, `docs/COOLIFY.md`, `CLAUDE.md`, `CHANGELOG.md`, `docker-compose.yml`, `docker-compose.coolify.yml` (nur Stellen, die das Produkt-Konzept Environment meinen, nicht Umgebungsvariablen), `.github/ISSUE_TEMPLATE/bug_report.md` falls dort das Konzept gemeint ist
- Modify: `docs/superpowers/specs/2026-11-11-translately-design.md` (ein Hinweis-Absatz ganz oben: Abschnitte zu Environments und Kopieren sind durch das Design vom 2026-11-12 ersetzt)

- [ ] **Step 1:** Texte anpassen: Auslieferungs-URL ohne Environment, kein Kopieren zwischen Environments, API-Keys ohne Environment-Bindung. `CLAUDE.md`: „pro Key, Sprache und Brand“.
- [ ] **Step 2:** In README und `docs/COOLIFY.md` einen Abschnitt „Umstieg von einem Stand mit Environments“: Die Datenbank muss vor dem ersten Start von Hand geleert werden, sonst scheitert `prisma db push` am neuen eindeutigen Index und das Backend startet nicht.
- [ ] **Step 3:** `grep -rin "environment" README.md docs/COOLIFY.md CLAUDE.md` → nur Umgebungsvariablen und der Umstiegs-Abschnitt.
- [ ] **Step 4:** Commit `docs: describe translately without environments`.
