# Translately 2/3 – Backend für Übersetzungen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Backend speichert Übersetzungstexte pro Key, Sprache, Environment und Brand, bietet eine Verwaltungs-API mit Import, Export und Kopieren und liefert i18next-kompatibles JSON an die App aus.

**Architecture:** Neues Modul `backend/src/modules/translations`. Die Fachlogik (Baum ↔ flache Keys, Brand-Zusammenführung, Vergleich) liegt in reinen Funktionen ohne Datenbank; Services laden die Zeilen und rufen sie auf. Jede Schreiboperation ruft `ChangeEventsService.recordChange` (erhöht `ConfigVersion` → neues ETag, Webhook) und schreibt einen Audit-Eintrag. Die Auslieferung ist wie früher die Flag-Route ein roher HTTP-Handler in `main.ts` unter `/sdk/translations/…`.

**Tech Stack:** NestJS 11, Prisma 5 (MongoDB), Jest, class-validator.

**Spec:** `docs/superpowers/specs/2026-11-11-translately-design.md` (Abschnitte 6, 7, 8 „Import“ und „Kopieren“, 10)

**Voraussetzung:** Plan 1 ist abgeschlossen. Arbeitsordner: `C:\Users\nuVo\Documents\translately`.

## Global Constraints

- Backend: kein `import type`. Conventional Commits mit der `Co-Authored-By`-Zeile aus `CLAUDE.md`.
- Grenzen (in `backend/src/modules/translations/limits.ts`, exakt diese Namen und Werte):
  - `MAX_KEY_LENGTH = 256`, `MAX_VALUE_LENGTH = 10_000`, `MAX_DESCRIPTION_LENGTH = 500`
  - `MAX_IMPORT_BYTES = 2 * 1024 * 1024`, `MAX_IMPORT_KEYS = 20_000`
  - `MAX_LANGUAGES = 100`, `MAX_NAMESPACES = 50`, `MAX_PAGE_SIZE = 200`, `DEFAULT_PAGE_SIZE = 50`
  - `LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`
  - `NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/`, `DEFAULT_NAMESPACE = 'translation'`
  - `DEFAULT_SCOPE = 'default'`
- Ein Key ist gültig, wenn er 1–256 Zeichen hat, keine Steuerzeichen enthält, nicht mit `.` beginnt oder endet, kein `..` enthält und kein Segment `__proto__`, `constructor` oder `prototype` heißt.
- Ein leerer Text (`''`) wird nie gespeichert: Setzen auf `''` löscht die Zeile.
- Sprachcodes werden so gespeichert und verglichen, wie sie eingegeben wurden (Groß-/Kleinschreibung zählt), weil i18next `pt-BR` genau so anfragt.
- Rollen wie bisher über `AccessService`: lesen `VIEWER`, schreiben `MEMBER`, Keys/Sprachen/Namespaces löschen `ADMIN`.
- Import und Kopieren löschen nie Texte.
- Prüfbefehl: `cd backend && npm run typecheck && npm test && npm run build`.

## Review Focus

- **Prototype Pollution beim Import:** Datei mit `{"__proto__": {"x": "1"}}` oder Key `a.constructor.b` → Eintrag wird übersprungen und gemeldet, `({}).x` bleibt `undefined` (Task 2).
- **Blatt/Eltern-Konflikt:** `a` existiert, `a.b` wird angelegt, umbenannt oder importiert (und umgekehrt) → 409 bzw. übersprungen mit Grund `conflict`; die Auslieferung wirft nie (Tasks 2, 4, 7).
- **Brand fragt fremde Sprache ab / SINGLE-Projekt bekommt `brandKey`:** `{}` bzw. `brandKey` wird ignoriert und die Standarddatei geliefert (Task 5, 6).
- **Gleichzeitiges Speichern derselben Zelle:** zwei `setValue` für dieselbe Zelle → kein 500 durch den Unique-Index, letzter Wert gewinnt (Task 4).
- **Große Datei:** 2 MB / 20 000 Keys importieren → Bulk-Operationen statt einer Abfrage pro Key; darüber 413 mit klarer Meldung statt Timeout (Task 7).

---

### Task 1: Datenmodell

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`
- Create: `backend/src/modules/translations/limits.ts`

**Interfaces:**
- Produces (Prisma):

```prisma
model TranslationKey {
  id             String   @id @default(auto()) @map("_id") @db.ObjectId
  projectId      String   @db.ObjectId
  organizationId String   @db.ObjectId
  namespace      String   @default("translation")
  key            String
  description    String?
  createdById    String   @db.ObjectId
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  project        Project  @relation(fields: [projectId], references: [id])
  values         TranslationValue[]
  @@unique([projectId, namespace, key])
  @@index([projectId, namespace])
  @@map("translation_keys")
}

model TranslationValue {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  keyId         String   @db.ObjectId
  projectId     String   @db.ObjectId
  environmentId String   @db.ObjectId
  language      String
  /// 'default' oder die Id der Brand (bewusst kein nullable Feld: eindeutiger Index)
  scope         String   @default("default")
  value         String
  updatedById   String?  @db.ObjectId
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  key           TranslationKey @relation(fields: [keyId], references: [id], onDelete: Cascade)
  @@unique([keyId, environmentId, language, scope])
  @@index([projectId, environmentId, language, scope])
  @@map("translation_values")
}
```

  sowie `Project.languages String[] @default([])`, `Project.namespaces String[] @default(["translation"])`, `Project.translationKeys TranslationKey[]`, `Brand.languages String[] @default([])`.
- Produces: `limits.ts` mit den Konstanten aus den Global Constraints und `isValidKey(key: string): boolean`.

- [ ] **Step 1: Test** `backend/src/modules/translations/limits.spec.ts`:

```ts
it.each(['a', 'checkout.button.submit', 'item_one', 'Hello world'])('akzeptiert %s', (k) => expect(isValidKey(k)).toBe(true))
it.each(['', '.a', 'a.', 'a..b', 'a.__proto__.b', 'constructor', 'a\nb', 'x'.repeat(257)])('lehnt %j ab', (k) => expect(isValidKey(k)).toBe(false))
it('LANGUAGE_PATTERN', () => {
  for (const ok of ['de', 'en', 'pt-BR', 'zh-Hant-TW']) expect(LANGUAGE_PATTERN.test(ok)).toBe(true)
  for (const bad of ['', 'd', 'de_DE', '../x', 'de-']) expect(LANGUAGE_PATTERN.test(bad)).toBe(false)
})
```

- [ ] **Step 2:** `npx jest limits` → FAIL. **Step 3:** `limits.ts` schreiben. **Step 4:** → PASS.
- [ ] **Step 5:** Schema ergänzen, `npx prisma generate`. `seed.ts`: Demo-Projekt mit Sprachen `['de','en']`, drei Keys (`checkout.title`, `checkout.submit`, `cart.empty`) und Standardtexten in jedem Environment.
- [ ] **Step 6:** Prüfbefehl grün. Commit `feat(translations): add data model and limits`.

### Task 2: Reine Funktionen – Baum, Zusammenführung, Vergleich

**Files:**
- Create: `backend/src/modules/translations/translation-tree.ts`, `translation-merge.ts`, `translation-diff.ts` und je eine `.spec.ts`

**Interfaces:**
- Produces:

```ts
// translation-tree.ts
export type SkipReason = 'not_string' | 'empty' | 'invalid_key' | 'too_long' | 'conflict'
export interface SkippedEntry { key: string; reason: SkipReason }
export interface FlattenResult { entries: Record<string, string>; skipped: SkippedEntry[] }
/** Verschachteltes oder flaches i18next-JSON → flache Keys in Punkt-Notation. */
export function flattenTree(input: unknown): FlattenResult
/** Flache Keys → verschachteltes Objekt. Konflikte (a und a.b): das Blatt `a` gewinnt, `a.b` entfällt. Wirft nie. */
export function buildTree(entries: Record<string, string>): Record<string, unknown>
/** Erster Key aus `candidates`, der mit einem Key aus `existing` oder einem anderen Kandidaten als Blatt/Eltern kollidiert. */
export function findKeyConflict(candidates: string[], existing: string[]): { key: string; conflictsWith: string } | null

// translation-merge.ts
/** Brand-Datei: Standardtexte, überlagert von den Überschreibungen. */
export function mergeBrandFile(defaults: Record<string, string>, overrides: Record<string, string>): Record<string, string>

// translation-diff.ts
export interface EntriesDiff { added: string[]; changed: string[]; unchanged: string[]; targetOnly: string[] }
/** Was passiert, wenn `source` additiv auf `target` angewendet wird. Alle Listen alphabetisch. */
export function diffEntries(source: Record<string, string>, target: Record<string, string>): EntriesDiff
```

- [ ] **Step 1: Tests** (Auszug, alle als eigene `it`):

```ts
// translation-tree.spec.ts
expect(flattenTree({ a: { b: 'x' }, c: 'y' }).entries).toEqual({ 'a.b': 'x', c: 'y' })
expect(flattenTree({ 'a.b': 'x' }).entries).toEqual({ 'a.b': 'x' })                 // flach
expect(flattenTree({ n: 1, l: ['x'], z: null, e: '', ok: 'v' })).toEqual({
  entries: { ok: 'v' },
  skipped: [ { key: 'n', reason: 'not_string' }, { key: 'l', reason: 'not_string' },
             { key: 'z', reason: 'not_string' }, { key: 'e', reason: 'empty' } ] })
expect(flattenTree(JSON.parse('{"__proto__":{"x":"1"},"ok":"v"}'))).toEqual({
  entries: { ok: 'v' }, skipped: [{ key: '__proto__.x', reason: 'invalid_key' }] })
expect(({} as any).x).toBeUndefined()
expect(flattenTree({ a: 'x'.repeat(10_001) }).skipped).toEqual([{ key: 'a', reason: 'too_long' }])
expect(flattenTree({ a: 'x', 'a.b': 'y' }).skipped).toEqual([{ key: 'a.b', reason: 'conflict' }])
expect(flattenTree('nope')).toEqual({ entries: {}, skipped: [] })                    // kein Objekt
expect(buildTree({ 'a.b': 'x', 'a.c': 'y', d: 'z' })).toEqual({ a: { b: 'x', c: 'y' }, d: 'z' })
expect(buildTree({ a: 'x', 'a.b': 'y' })).toEqual({ a: 'x' })
expect(buildTree(flattenTree(sample).entries)).toEqual(sample)                       // Round-Trip, sample mit _one/_other und {{count}}
expect(findKeyConflict(['a.b'], ['a'])).toEqual({ key: 'a.b', conflictsWith: 'a' })
expect(findKeyConflict(['a'], ['a.b.c'])).toEqual({ key: 'a', conflictsWith: 'a.b.c' })
expect(findKeyConflict(['ab'], ['a'])).toBeNull()                                    // nur Präfix, kein Segment
expect(findKeyConflict(['x', 'x.y'], [])).toEqual({ key: 'x.y', conflictsWith: 'x' })
// translation-merge.spec.ts
expect(mergeBrandFile({ a: '1', b: '2' }, { b: 'B', c: 'C' })).toEqual({ a: '1', b: 'B', c: 'C' })
// translation-diff.spec.ts
expect(diffEntries({ a: '1', b: '2', c: '3' }, { b: '2', c: 'X', d: '4' }))
  .toEqual({ added: ['a'], changed: ['c'], unchanged: ['b'], targetOnly: ['d'] })
```

- [ ] **Step 2:** `npx jest translation-` → FAIL.
- [ ] **Step 3:** Implementieren. `flattenTree` und `buildTree` arbeiten mit `Object.create(null)` bzw. `Map` und iterieren mit `Object.keys` (kein `for…in`); `buildTree` gibt am Ende normale Objekte zurück. Reihenfolge in `skipped`: Reihenfolge des Auftretens.
- [ ] **Step 4:** → PASS. Commit `feat(translations): add tree, merge and diff helpers`.

### Task 3: Change-Events und Webhooks umbenennen

**Files:**
- Modify: `backend/src/modules/change-events/change-events.types.ts`, `change-events.service.ts`, `change-bus.ts`, `backend/src/modules/webhooks/webhook-payload.ts`, `webhook-dispatcher.ts`, zugehörige Specs; `frontend/src/lib/webhooks.ts(+test)` (nur der Ereignisname)

**Interfaces:**
- Produces:

```ts
export type ChangeAction = 'created' | 'updated' | 'deleted' | 'imported' | 'copied'
  | 'languages_changed' | 'environment_changed' | 'brand_changed'
export interface TranslationChange { key?: string; namespace?: string; language?: string; action: ChangeAction }
export interface TranslationsChangedEvent { /* Felder wie bisher FlagsChangedEvent, `changes: TranslationChange[]` */ }
export interface RecordChangeInput { organizationId: string; projectId: string; environmentIds: string[] | 'all'; changes: TranslationChange[]; environmentKeys?: Record<string, string> }
export type WebhookEventType = 'translations.changed' | 'webhook.test'
```

  Dedupe-Schlüssel im Puffer: `namespace␀key␀language␀action`.

- [ ] **Step 1:** In `change-events.service.spec.ts` und `webhook-dispatcher.spec.ts` die Erwartungen umstellen (`type: 'translations.changed'`, `changes: [{ key: 'a.b', namespace: 'translation', language: 'de', action: 'updated' }]`); neuer Test: zwei Änderungen mit gleichem Key, aber verschiedener Sprache, bleiben zwei Einträge. → FAIL.
- [ ] **Step 2:** Typen und Verwendungen umbenennen. → PASS. Prüfbefehl grün.
- [ ] **Step 3:** Commit `refactor(change-events): rename flag changes to translation changes`.

### Task 4: Keys und Texte – Service und Verwaltungs-API

**Files:**
- Create: `backend/src/modules/translations/translations.module.ts`, `translations.service.ts`, `translations.controller.ts`, `dto/create-key.dto.ts`, `dto/update-key.dto.ts`, `dto/set-value.dto.ts`, `dto/table-query.dto.ts`, Specs für Service und Controller
- Modify: `backend/src/app.module.ts`, `backend/src/shared/access/access.service.ts(+spec)`

**Interfaces:**
- Consumes: `limits.ts`, `findKeyConflict`, `mergeBrandFile`, `ChangeEventsService.recordChange`, `writeAudit`/`AuditLogsService` (wie zuvor in `flags.service.ts` genutzt; Muster dort im Togglely-Repo nachlesen).
- Produces (`TranslationsService`):

```ts
export interface TableCell { value: string | null; inherited: boolean }   // inherited nur bei Brand-Sicht true
export interface TableRow { keyId: string; key: string; description: string | null; values: Record<string, TableCell> }
export interface TranslationTable { languages: string[]; namespaces: string[]; rows: TableRow[]; total: number; page: number; pageSize: number }
export interface TableQuery { environmentId: string; namespace?: string; brandId?: string; search?: string; missingOnly?: boolean; page?: number; pageSize?: number }

getTable(projectId: string, query: TableQuery): Promise<TranslationTable>
createKey(projectId: string, userId: string, dto: { namespace?: string; key: string; description?: string }): Promise<{ id: string; namespace: string; key: string }>
updateKey(keyId: string, userId: string, dto: { key?: string; description?: string | null }): Promise<{ id: string; namespace: string; key: string }>
deleteKey(keyId: string, userId: string): Promise<void>
setValue(keyId: string, userId: string, dto: { environmentId: string; language: string; brandId?: string; value: string }): Promise<TableCell>
```

  `AccessService.assertTranslationKeyAccess(userId, keyId, minRole): Promise<{ key: TranslationKey }>` (404, wenn der Key fehlt oder die Id keine ObjectId ist).
- Produces (HTTP, alle unter `/api`, `AuthGuard`):

| Methode, Pfad | Rolle | Antwort |
|---|---|---|
| `GET projects/:projectId/translations` + `TableQuery` | VIEWER | `TranslationTable` |
| `POST projects/:projectId/translation-keys` | MEMBER | `{ key: {…} }`, 409 bei Duplikat oder Blatt/Eltern-Konflikt |
| `PATCH translation-keys/:keyId` | MEMBER | `{ key: {…} }`, 409 wie oben |
| `DELETE translation-keys/:keyId` | ADMIN | `{ success: true }` |
| `PUT translation-keys/:keyId/value` | MEMBER | `{ cell: TableCell }` |

Regeln, die Signatur und Tests nicht festlegen:
- `getTable`: Spalten sind bei `brandId` die Sprachen der Brand, sonst die des Projekts. Zelle der Brand-Sicht: eigener Text → `{ value, inherited: false }`; sonst Standardtext → `{ value, inherited: true }`; sonst `{ value: null, inherited: false }`. `search` filtert ohne Groß-/Kleinschreibung über Key und über die Texte der Sicht. `missingOnly` behält Zeilen mit mindestens einer Zelle `value === null`. Sortierung nach Key; `pageSize` wird auf `MAX_PAGE_SIZE` begrenzt. Zwei Abfragen pro Aufruf (Keys, Werte), keine pro Zeile.
- `setValue`: `value === ''` löscht die Zeile der Sicht (bei Brand = wieder verknüpfen) und gibt die danach gültige Zelle zurück. Sprache muss in der Sprachliste der Sicht stehen, sonst 400. Schreiben per `upsert`; bei `P2002` einmal wiederholen.
- `createKey`/`updateKey`: Namespace muss in `Project.namespaces` stehen (400); Konfliktprüfung gegen alle Keys desselben Namespace.
- Jede Schreiboperation: `recordChange` (`createKey`/`updateKey`/`deleteKey`: `environmentIds: 'all'`; `setValue`: das eine Environment) und ein Audit-Eintrag mit `entityType: 'TranslationKey'` und `action` `translation.key_created | key_updated | key_deleted | value_updated | value_deleted`.

- [ ] **Step 1: Service-Tests** (Prisma gemockt wie in den vorhandenen Service-Specs), mindestens:
  - Standard-Sicht: Zelle mit Text, Zelle ohne Text (`null`), `inherited` immer `false`
  - Brand-Sicht: eigener Text / geerbt / fehlt; Spalten = Brand-Sprachen
  - `missingOnly` und `search` (Treffer im Key, Treffer im Text, kein Treffer)
  - `pageSize: 1000` → 200
  - `createKey` Duplikat → `ConflictException`; `createKey('a.b')` bei vorhandenem `a` → `ConflictException` mit Meldung, die `a` nennt
  - `updateKey` Umbenennen in Konflikt → `ConflictException`
  - `setValue` mit `''` ruft `deleteMany` und liefert bei Brand die geerbte Zelle
  - `setValue` Sprache nicht in Liste → `BadRequestException`
  - `setValue`: erster `upsert` wirft `{ code: 'P2002' }`, zweiter gelingt → kein Fehler
  - jede Schreiboperation ruft `recordChange` mit den oben genannten `environmentIds`
- [ ] **Step 2: Controller-Tests:** jede Route ruft die passende `assert…Access` mit der Rolle aus der Tabelle; `PUT …/value` prüft zusätzlich `assertEnvironmentInProject` und bei `brandId` `assertBrandInProject`.
- [ ] **Step 3:** Tests → FAIL. **Step 4:** Implementieren, Modul in `app.module.ts` eintragen. **Step 5:** → PASS, Prüfbefehl grün.
- [ ] **Step 6:** Commit `feat(translations): manage keys and values`.

### Task 5: Sprachen, Namespaces und Aufräumen

**Files:**
- Create: `backend/src/modules/translations/translation-settings.service.ts(+spec)`, `dto/set-languages.dto.ts`, `dto/namespace.dto.ts`
- Modify: `translations.controller.ts(+spec)`, `translations.module.ts`, `backend/src/modules/brands/brands.service.ts(+spec)`, `backend/src/modules/environments/environments.service.ts(+spec)`, `backend/src/modules/change-events/project-cleanup.ts(+spec)`, `backend/src/modules/projects/projects.service.ts` (Antwort enthält `languages`, `namespaces`), `backend/src/modules/brands` (Antwort enthält `languages`), `backend/src/modules/overview/overview.service.ts(+spec)`

**Interfaces:**
- Produces:

```ts
setProjectLanguages(projectId: string, userId: string, languages: string[]): Promise<{ languages: string[]; removedValues: number }>
setBrandLanguages(brandId: string, userId: string, languages: string[]): Promise<{ languages: string[]; removedValues: number }>
addNamespace(projectId: string, userId: string, namespace: string): Promise<{ namespaces: string[] }>
removeNamespace(projectId: string, userId: string, namespace: string): Promise<{ namespaces: string[]; removedKeys: number }>
```

| Methode, Pfad | Rolle |
|---|---|
| `PUT projects/:projectId/languages` Body `{ languages: string[] }` | ADMIN |
| `PUT brands/:brandId/languages` Body `{ languages: string[] }` | ADMIN |
| `POST projects/:projectId/namespaces` Body `{ namespace }` | ADMIN |
| `DELETE projects/:projectId/namespaces/:namespace` | ADMIN |

- `OverviewService` liefert pro Projekt zusätzlich `keyCount`, `languageCount`, `missingCount` (fehlende Standardtexte über alle Environments und Projektsprachen).

Regeln:
- Listen werden entdoppelt, Reihenfolge der Eingabe bleibt; jeder Code muss `LANGUAGE_PATTERN` erfüllen; höchstens `MAX_LANGUAGES`.
- Entfernte Projektsprache: löscht alle Werte mit `scope = 'default'` in dieser Sprache. Werte von Brands bleiben.
- Entfernte Brand-Sprache: löscht die Werte mit `scope = brandId` in dieser Sprache.
- `removeNamespace('translation')` → 400. Entfernen löscht die Keys des Namespace (Werte per Cascade).
- Brand löschen: Werte mit `scope = brandId` löschen. Environment löschen: Werte dieses Environments löschen. Projekt löschen: Keys (und damit Werte) löschen. Neue Environments starten leer.
- Alle vier Operationen: `recordChange` mit `environmentIds: 'all'`, Aktion `languages_changed` bzw. `deleted`; Audit-Eintrag.

- [ ] **Step 1: Tests:** für jede Regel oben ein Test (inkl. „Brand-Werte bleiben, wenn das Projekt die Sprache entfernt“, „`translation` nicht entfernbar“, „ungültiger Code → 400“, „Duplikate werden zusammengefasst“), dazu je ein Test in den Specs von `brands`, `environments`, `project-cleanup` für das Aufräumen und in `overview` für `missingCount` (2 Keys × 2 Sprachen × 2 Environments, 3 Werte vorhanden → 5).
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS, Prüfbefehl grün.
- [ ] **Step 5:** Commit `feat(translations): languages, namespaces and cleanup`.

### Task 6: Datei-Service und Auslieferung

**Files:**
- Create: `backend/src/modules/translations/translation-files.service.ts(+spec)`, `backend/src/modules/translations/translations-delivery.ts(+spec)`, `backend/src/modules/translations/i18next-compat.spec.ts`
- Modify: `backend/src/main.ts`, `translations.module.ts`, `backend/package.json` (devDependency `i18next`)

**Interfaces:**
- Consumes: `SdkService.resolveSdkAccess`, `SdkService.resolveBrandId`, `computeSdkEtag(version, scope, parts)`, `etagMatches`, `extractSdkApiKey`, `extractSdkOrigin`, `extractEffectiveBrandKey`, `setSdkCorsHeaders`, `mapSdkError`, `ChangeEventsService.getVersion`, `mergeBrandFile`, `buildTree`.
- Produces:

```ts
// translation-files.service.ts
/** Flache, zusammengeführte Datei. brandId null = Standard. Brand ohne diese Sprache → {}. */
getFile(input: { project: Project; environmentId: string; namespace: string; language: string; brandId: string | null }): Promise<Record<string, string>>

// translations-delivery.ts
export const TRANSLATIONS_ROUTE = '/sdk/translations/:projectKey/:environmentKey/:lng/:ns'
export interface DeliveryDeps { sdkService: Pick<SdkService, 'resolveSdkAccess' | 'resolveBrandId'>; files: Pick<TranslationFilesService, 'getFile'>; changeEvents: { getVersion(projectId: string, environmentId: string): Promise<number> }; logger: { debug(m: string): void; error(m: string, ...r: unknown[]): void } }
export function handleTranslationsRequest(deps: DeliveryDeps, req: { params: Record<string, string>; query: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }, res: any): Promise<void>
```

Ablauf des Handlers (Reihenfolge ist verbindlich): CORS-Header → fehlender API-Key 401 → `resolveSdkAccess` → `ns` ohne Endung `.json` → Version → ETag aus `[lng, ns, brandKey ?? '']` → Header `ETag`, `Cache-Control: private, no-cache`, `Vary: Origin, X-API-Key, Authorization` → bei Treffer 304 → sonst `resolveBrandId` (liefert bei SINGLE-Projekten und unbekannter Brand `null`) → `getFile` → `res.json(buildTree(file))`. `lng` oder `ns`, die `LANGUAGE_PATTERN`/`NAMESPACE_PATTERN` nicht erfüllen oder dem Projekt unbekannt sind: 200 mit `{}`. Fehler: ETag entfernen, `mapSdkError`.

- [ ] **Step 1: Tests `translation-files.service.spec.ts`:** Standarddatei; Brand mit Überschreibung (eigener Text für `b`, Standard für `a`); Brand, deren `languages` die Sprache nicht enthält → `{}` ohne Datenbankabfrage der Werte; Brand mit Sprache, die das Projekt nicht hat → nur Brand-Texte; unbekannter Namespace → `{}`. Genau eine Werte-Abfrage pro Aufruf.
- [ ] **Step 2: Tests `translations-delivery.spec.ts`** (Abhängigkeiten als Fakes):
  - ohne API-Key → 401, Code `SDK_ERROR_CODES.missingApiKey`
  - Erfolg → verschachteltes JSON, `ETag` gesetzt, `Cache-Control: private, no-cache`
  - `ns = 'common.json'` → `getFile` wird mit `namespace: 'common'` aufgerufen
  - `If-None-Match` = aktuelles ETag → 304, `getFile` nicht aufgerufen
  - Version erhöht → anderes ETag; andere Sprache oder Brand → anderes ETag
  - `lng = '../etc'` → 200 `{}`, `getFile` nicht aufgerufen
  - `resolveSdkAccess` wirft `UnauthorizedException` → 401, kein `ETag`-Header
  - `brandKey` gesetzt, `resolveBrandId` liefert `null` → `getFile` mit `brandId: null`
- [ ] **Step 3: Test `i18next-compat.spec.ts`:** aus `{ 'checkout.submit': 'Jetzt kaufen', 'cart.items_one': '{{count}} Artikel', 'cart.items_other': '{{count}} Artikel gesamt' }` per `buildTree` Ressourcen bauen, `i18next.createInstance().init({ lng: 'de', resources: { de: { translation: tree } } })`, dann `t('checkout.submit') === 'Jetzt kaufen'`, `t('cart.items', { count: 1 }) === '1 Artikel'` und `t('cart.items', { count: 3 }) === '3 Artikel gesamt'`.
- [ ] **Step 4:** → FAIL. **Step 5:** Implementieren. In `main.ts` nach dem `/sdk`-Rate-Limiter `httpAdapter.options(TRANSLATIONS_ROUTE, …)` (wie früher bei den Flags) und `httpAdapter.get(TRANSLATIONS_ROUTE, (req, res) => handleTranslationsRequest(deps, req, res))` registrieren; Swagger-Eintrag für die Route ergänzen. **Step 6:** → PASS, Prüfbefehl grün.
- [ ] **Step 7:** Commit `feat(translations): deliver i18next json`.

### Task 7: Import und Export

**Files:**
- Create: `backend/src/modules/translations/translation-import.service.ts(+spec)`, `dto/import.dto.ts`
- Modify: `translations.controller.ts(+spec)`, `translations.module.ts`, `backend/src/main.ts` (Body-Limit)

**Interfaces:**
- Consumes: `flattenTree`, `findKeyConflict`, `diffEntries`, `buildTree`, `TranslationFilesService`.
- Produces:

```ts
export interface ImportTarget { environmentId: string; language: string; namespace?: string; brandId?: string }
export interface ImportPreview { added: string[]; changed: string[]; unchanged: string[]; newKeys: string[]; skipped: SkippedEntry[] }
preview(projectId: string, target: ImportTarget, content: unknown): Promise<ImportPreview>
apply(projectId: string, userId: string, target: ImportTarget, content: unknown): Promise<ImportPreview>
```

| Methode, Pfad | Rolle | Body / Antwort |
|---|---|---|
| `POST projects/:projectId/translations/import/preview` | MEMBER | `{ …ImportTarget, content }` → `ImportPreview` |
| `POST projects/:projectId/translations/import` | MEMBER | wie oben → `ImportPreview` |
| `GET projects/:projectId/translations/export?environmentId&language&namespace&brandId` | VIEWER | verschachteltes JSON, `Content-Disposition: attachment; filename="<ns>.<lng>.json"` |

Regeln:
- Verglichen wird mit den eigenen Texten der Zielsicht (bei Brand: nur die Überschreibungen, nicht das Geerbte). Ein importierter Brand-Text, der dem geerbten Standardtext gleicht, wird nicht als Überschreibung angelegt und zählt als `unchanged`.
- `newKeys`: Keys, die es im Projekt noch nicht gibt; `apply` legt sie an. Einträge, die mit vorhandenen Keys als Blatt/Eltern kollidieren, landen mit `conflict` in `skipped`.
- Mehr als `MAX_IMPORT_KEYS` Einträge → 413. Body-Limit: in `main.ts` für genau die beiden Import-Pfade `express.json({ limit: MAX_IMPORT_BYTES })`, überall sonst der Standard; Überschreitung → 413 mit Meldung „Datei zu groß (max. 2 MB)“.
- `apply`: Keys per `createMany`, Werte in Bulk-Operationen (kein Aufruf pro Key); danach **ein** `recordChange` (`action: 'imported'`, das eine Environment) und **ein** Audit-Eintrag `translation.imported` mit `newValues: { language, namespace, scope, added: n, changed: n, skipped: n }`.
- Sprache muss zur Sprachliste der Zielsicht gehören, Namespace zum Projekt (400).
- Export = `buildTree` der eigenen plus geerbten Texte der Sicht (identisch zur Auslieferung, aber ohne Brand-Sprachfilter-Sonderfall: nicht angebotene Sprache → 400).

- [ ] **Step 1: Tests:** Vorschau mit je einem neuen, geänderten, unveränderten Eintrag; `skipped` wird durchgereicht; Konflikt mit vorhandenem Key; Brand-Import mit Text gleich Standard → `unchanged` und kein Schreibzugriff; `apply` schreibt keine `delete*`-Operation (Mock prüft, dass `deleteMany` nie aufgerufen wird); 20 001 Einträge → `PayloadTooLargeException`; `apply` ruft `recordChange` und Audit genau einmal; `apply` mit 5 000 Einträgen ruft höchstens 10 Prisma-Schreiboperationen auf; Export nach Import liefert das importierte Objekt zurück (Round-Trip mit dem `sample` aus Task 2).
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS, Prüfbefehl grün.
- [ ] **Step 5:** Commit `feat(translations): import and export json`.

### Task 8: Kopieren zwischen Environments

**Files:**
- Create: `backend/src/modules/translations/translation-copy.service.ts(+spec)`, `dto/copy.dto.ts`
- Modify: `translations.controller.ts(+spec)`, `translations.module.ts`

**Interfaces:**
- Produces:

```ts
export interface CopyPreviewGroup { scope: string; scopeName: string; language: string; namespace: string; added: number; changed: number; unchanged: number; targetOnly: number }
export interface CopyPreview { groups: CopyPreviewGroup[]; totals: { added: number; changed: number; unchanged: number; targetOnly: number }; samples: { added: string[]; changed: string[]; targetOnly: string[] } }  // samples: je höchstens 50 Einträge "namespace:key (language, scopeName)"
preview(projectId: string, sourceEnvironmentId: string, targetEnvironmentId: string): Promise<CopyPreview>
apply(projectId: string, userId: string, sourceEnvironmentId: string, targetEnvironmentId: string): Promise<CopyPreview>
```

| Methode, Pfad | Rolle |
|---|---|
| `POST projects/:projectId/translations/copy/preview` Body `{ sourceEnvironmentId, targetEnvironmentId }` | MEMBER |
| `POST projects/:projectId/translations/copy` | MEMBER |

Regeln: Quelle = Ziel → 400. Beide Environments müssen zum Projekt gehören. Kopiert werden alle Sprachen, Namespaces und Scopes (Standard und jede Brand). Additiv: anlegen und überschreiben, nie löschen. `scopeName` ist „Standard“-Kennung `'default'` bzw. der Brand-Name. Ein `recordChange` für das Ziel-Environment (`action: 'copied'`), ein Audit-Eintrag `translation.copied` mit Quelle, Ziel und `totals`. Schreiben in Bulk-Operationen.

- [ ] **Step 1: Tests:** Quelle hat `a`, `b` (Standard, de) und eine Brand-Überschreibung für `a`; Ziel hat `b` mit anderem Text und `z` → `totals` `{ added: 2, changed: 1, unchanged: 0, targetOnly: 1 }`; nach `apply` wird `z` nicht angefasst (`deleteMany` nie aufgerufen); Quelle = Ziel → `BadRequestException`; fremdes Environment → Fehler aus `assertEnvironmentInProject`; `recordChange` nur für das Ziel-Environment, genau einmal.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS, Prüfbefehl grün.
- [ ] **Step 5:** Commit `feat(translations): copy between environments`.

### Task 9: Durchstich gegen eine echte Datenbank

**Files:**
- Modify: nur bei gefundenen Fehlern

- [ ] **Step 1:** `docker compose up -d --build`, Setup durchlaufen, Projekt (MULTI) mit Sprachen `de`, `en`, Brand „premium“ mit Sprache `de`, API-Key anlegen (über die vorhandene Oberfläche bzw. `curl` gegen die Verwaltungs-API mit Login-Token).
- [ ] **Step 2:** Per `curl`: Key `checkout.submit` anlegen, Standardtext `de` in `development` setzen, Brand-Überschreibung setzen.
- [ ] **Step 3:** `curl -i -H "x-api-key: <key>" localhost:<port>/sdk/translations/<projekt>/development/de/translation` → 200, `{"checkout":{"submit":"…"}}`, `ETag` vorhanden. Mit `?brandKey=premium` → Brand-Text. Mit `?brandKey=premium` und `/en/` → `{}`. Erneut mit `If-None-Match` → 304. Text ändern, erneut → 200 mit neuem Text und neuem ETag.
- [ ] **Step 4:** Import einer echten i18next-Datei (z. B. `frontend/src/i18n/locales/de.ts` als JSON exportiert) per `curl`, danach Export und `diff` → identisch bis auf übersprungene Einträge.
- [ ] **Step 5:** Kopieren `development` → `production`, Abruf für `production` liefert dieselben Texte.
- [ ] **Step 6:** `docker compose down -v`. Fehler beheben, mit Test absichern, committen.
