# Translately 1/3 – Kopie, Aufräumen, Umbenennen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein neues, eigenständiges Repo `translately` entsteht als Kopie von Togglely (`c0c6f20`), aus dem alle Flag-, Experiment-, MCP- und SDK-Auswertungsteile entfernt sind, das „Translately“ heißt und baut, testet und startet.

**Architecture:** Der Stand wird per `git archive` in einen Nachbarordner kopiert und dort als frisches Repo initialisiert. Danach wird in vier Schritten abgebaut (Experiments/MCP → Flags/SDK-Auswertung im Backend → Frontend → Umbenennung); nach jedem Schritt sind Build und Tests grün. Infrastruktur, die Plan 2 wieder braucht (API-Key-/Origin-Prüfung, ETag, `ConfigVersion`, Change-Events, Webhooks), bleibt stehen.

**Tech Stack:** NestJS 11, Prisma 5 (MongoDB), Jest; React 19, Vite 8, Vitest; Biome; Docker.

**Spec:** `docs/superpowers/specs/2026-11-11-translately-design.md` (Abschnitte 4 und 5)

## Global Constraints

- Zielordner: `C:\Users\nuVo\Documents\translately`. Alle Pfade in diesem Plan sind relativ dazu, außer ausdrücklich `togglely/…`.
- Das Togglely-Repo wird nicht verändert (nur gelesen).
- Kein gemeinsames Paket, kein Monorepo, kein Submodul.
- Backend: kein `import type` (bricht NestJS DI); Biome `useImportType: "off"` bleibt.
- Conventional Commits. Jeder Commit endet mit `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` (Regel aus `CLAUDE.md`).
- Kein `git push`, kein Anlegen eines GitHub-Repos in diesem Plan: das macht der Auftraggeber oder gibt es ausdrücklich frei.
- Prüfbefehle: `cd backend && npm run typecheck && npm test && npm run build`, `cd frontend && npm run build && npm test`, im Root `npm run biome:check`.

## Review Focus

- Bestehende Datenbank mit alten Collections (`feature_flags`, …): Start darf nicht scheitern. Translately startet nur auf einer frischen Datenbank; die Start-Migrationen für Flags sind entfernt (Task 3 prüft, dass `PrismaService` ohne sie startet).
- Alte Lesezeichen (`/projects/:id/flags`, `/feature-flags`, `/experiments`, `/sdk-tester`): landen über die Catch-all-Route auf der Übersicht, keine weiße Seite (Task 4, Test `routes.test.ts`).
- Brand löschen / Environment löschen nach dem Abbau: Services dürfen keine entfernten Prisma-Modelle mehr ansprechen (Task 3, vorhandene Service-Specs laufen weiter).
- Bestehende Browser-Sitzung von Togglely auf gleicher Domain: umbenannte `localStorage`-Schlüssel führen zu einem sauberen Logout, nicht zu einem Fehler (Task 5, Test `session.test.ts`).
- Webhook-Empfänger: Signatur-Header heißt nach der Umbenennung anders; README nennt den neuen Namen (Task 5).

---

### Task 1: Kopie anlegen und Ausgangsstand prüfen

**Files:**
- Create: gesamter Ordner `C:\Users\nuVo\Documents\translately`
- Delete (in der Kopie): `docs/superpowers/plans/*`, `docs/superpowers/specs/*` außer den Translately-Dateien, `backend/prisma/prisma/`, `CHANGELOG.md`-Inhalt

- [ ] **Step 1:** Prüfen, dass der Zielordner nicht existiert: `test ! -e /c/Users/nuVo/Documents/translately && echo frei`. Erwartet: `frei`. Sonst abbrechen und melden.
- [ ] **Step 2:** Kopieren: `mkdir /c/Users/nuVo/Documents/translately && git -C /c/Users/nuVo/Documents/togglely archive c0c6f20 | tar -x -C /c/Users/nuVo/Documents/translately`
- [ ] **Step 3:** Die Translately-Dokumente aus dem Arbeitsstand von Togglely nachziehen (sie sind in `c0c6f20` nicht enthalten): `togglely/docs/superpowers/specs/2026-11-11-translately-design.md` und `togglely/docs/superpowers/plans/2026-11-11-translately-*.md` an dieselben Pfade kopieren; alle anderen Dateien unter `docs/superpowers/` löschen.
- [ ] **Step 4:** `grep -rn "prisma/prisma" --include=*.json --include=*.ts --include=*.yml --include=Dockerfile --include=Makefile .` Erwartet: keine Treffer → `backend/prisma/prisma/` löschen. Bei Treffern: stehen lassen und im Bericht nennen.
- [ ] **Step 5:** `CHANGELOG.md` auf die Überschrift plus einen Eintrag „Unreleased – Start als Kopie von Togglely `c0c6f20`“ kürzen.
- [ ] **Step 6:** `git init -b main`, `npm ci` in Root, `backend`, `frontend`.
- [ ] **Step 7:** Ausgangsstand prüfen (alle drei Prüfbefehle aus den Global Constraints). Erwartet: alles grün. Wenn hier etwas rot ist, liegt es an der Umgebung, nicht am Plan: abbrechen und melden.
- [ ] **Step 8:** Commit `chore: initial copy of togglely c0c6f20`.

### Task 2: Backend – Experiments, Event-Tracking und MCP entfernen

**Files:**
- Delete: `backend/src/modules/experiments/`, `backend/src/modules/events/`, `backend/src/modules/mcp/`
- Modify: `backend/src/app.module.ts`, `backend/prisma/schema.prisma`, `backend/src/shared/access/access.service.ts`, `backend/src/modules/sdk/sdk.service.ts`, `backend/src/modules/sdk/sdk-etag.ts`, `backend/src/modules/sdk/hashing.service.ts`, `backend/src/modules/api-keys/*`, `backend/package.json`

**Interfaces:**
- Produces: `ApiKeyType` hat nur noch `SERVER | CLIENT | SDK`. `AccessService` ohne `assertExperimentAccess`. `handleSdkFlagsRequest` ruft kein `trackExposuresForAccess` mehr auf.

- [ ] **Step 1:** Die drei Modul-Ordner löschen und ihre Imports/Einträge aus `app.module.ts` entfernen.
- [ ] **Step 2:** `schema.prisma`: Modelle `Experiment`, `ExperimentVariant`, `ExperimentEvent`, deren Enums und alle Relationen darauf (`Project.experiments`, `Environment.experiments`, `FeatureFlag.experiments`, …) entfernen; `MCP` aus `enum ApiKeyType` entfernen.
- [ ] **Step 3:** `sdk.service.ts`: `tryExperimentEvaluation`, `recordExposure`, `trackExposuresForAccess` und ihre Aufrufe entfernen; in `resolveSdkAccess` den Filter `type: { not: 'MCP' }` streichen. `sdk-etag.ts`: `trackExposuresForAccess` aus `SdkFlagsHandlerDeps` und dem 304-Zweig entfernen. `hashing.service.ts`: `isInTraffic` und nur von Experiments genutzte Methoden entfernen.
- [ ] **Step 4:** `access.service.ts`: `assertExperimentAccess` entfernen. `api-keys`: MCP-Typ aus DTO-Validierung, Service und Specs entfernen.
- [ ] **Step 5:** `backend/package.json`: `@modelcontextprotocol/sdk` entfernen, `npm install`.
- [ ] **Step 6:** Betroffene Specs anpassen (Tests zu entfernten Funktionen löschen, übrige unverändert lassen).
- [ ] **Step 7:** `cd backend && npx prisma generate && npm run typecheck && npm test && npm run build`. Erwartet: grün.
- [ ] **Step 8:** `grep -rniE "experiment|mcp" backend/src backend/prisma/schema.prisma` Erwartet: keine Treffer.
- [ ] **Step 9:** Commit `refactor(backend): remove experiments, event tracking and mcp`.

### Task 3: Backend – Flags, Targeting und SDK-Auswertung entfernen

**Files:**
- Delete: `backend/src/modules/flags/`, `backend/src/domain/flag.entity.ts`, `backend/src/shared/brand-inherit.migration.ts(+spec)`, `backend/src/shared/flag-wide-rules.migration.ts(+spec)`, `backend/src/modules/projects/dto/import-flags.dto.ts`, in `backend/src/modules/sdk/`: `evaluation.service.ts`, `condition-groups.ts`, `condition-tree.ts`, `rule-schedule.ts`, `rule-scope.ts`, `sdk-stream.ts`, `hashing.service.ts`, `sdk.helpers.spec.ts`-Teile zu Flags (jeweils mit Specs)
- Modify: `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/src/app.module.ts`, `backend/src/main.ts`, `backend/src/shared/prisma.service.ts`, `backend/src/shared/access/access.service.ts`, `backend/src/modules/sdk/{sdk.module,sdk.service,sdk-etag,sdk.helpers,sdk-http.utils}.ts`, `backend/src/modules/{brands,projects,environments,organizations,overview,audit-logs,change-events,webhooks}/*`

**Interfaces:**
- Produces (bleibt für Plan 2 stehen, exakt diese Namen):
  - `SdkService.resolveSdkAccess(projectKey, environmentKey, apiKey, origin?): Promise<SdkAccess>` (unverändert)
  - `SdkService.resolveBrandId(project: Project, brandKey?: string): Promise<string | null>` (jetzt `public`)
  - `computeSdkEtag(version: number, scope: SdkEtagScope, parts: string[]): string` (die Parameter `brandKey`, `context`, `flagKey` werden durch ein String-Array ersetzt, das in dieser Reihenfolge in den Hash eingeht)
  - `extractEffectiveBrandKey(query: Record<string, unknown>): string | undefined` (nur noch ein Parameter, siehe Step 4)
  - `etagMatches`, `extractSdkApiKey`, `extractSdkOrigin`, `setSdkCorsHeaders`, `mapSdkError`, `isOriginAllowed`, `SDK_ERROR_CODES`, `SDK_CORS_*` (unverändert)
  - `ChangeEventsService.recordChange` / `getVersion`, Prisma-Modell `ConfigVersion`, Webhook-Typ `'flags.changed'` (unverändert; Plan 2 benennt um)
  - `main.ts`: Rate-Limiter und CORS für `/sdk/*` bleiben; es ist keine `/sdk/…`-Route mehr registriert.
  - `OverviewService` liefert pro Projekt nur noch Name, Key, Typ, Anzahl Environments und Brands.

- [ ] **Step 1: Test zuerst** – in `backend/src/modules/sdk/sdk-etag.spec.ts` die `computeSdkEtag`-Tests auf die neue Signatur umstellen:

```ts
const scope = { organizationId: 'o', projectId: 'p', environmentId: 'e' }
it('ändert sich mit der Version', () => {
  expect(computeSdkEtag(1, scope, ['de'])).not.toBe(computeSdkEtag(2, scope, ['de']))
})
it('unterscheidet die Teile und ihre Reihenfolge', () => {
  expect(computeSdkEtag(1, scope, ['de', 'a'])).not.toBe(computeSdkEtag(1, scope, ['a', 'de']))
})
it('hat die Form W/"<version>-<16 hex>"', () => {
  expect(computeSdkEtag(7, scope, [])).toMatch(/^W\/"7-[a-f0-9]{16}"$/)
})
```

- [ ] **Step 2:** `npx jest sdk-etag` → FAIL (alte Signatur).
- [ ] **Step 3:** `sdk-etag.ts`: `computeSdkEtag` umstellen; `handleSdkFlagsRequest`, `SdkFlagsHandlerDeps`, `SDK_FLAGS_VARY` entfernen (Plan 2 schreibt den neuen Handler). Spec-Tests des alten Handlers löschen. `npx jest sdk-etag` → PASS.
- [ ] **Step 4:** `sdk.service.ts` auf `resolveSdkAccess` + öffentliches `resolveBrandId` reduzieren; Konstruktor nur noch `PrismaService`. `sdk.module.ts`: nur `SdkService` bereitstellen und exportieren. `sdk.helpers.ts`: nur `isOriginAllowed` behalten. `sdk-http.utils.ts`: `parseSdkContext` und die `SDK_CONTEXT_*`-Konstanten entfernen; `extractEffectiveBrandKey(query)` liest nur noch `brandKey`/`tenantId` aus der Query.
- [ ] **Step 5:** `main.ts`: alle `httpAdapter.get/options('/sdk/flags…')` und `/sdk/stream…`, `SdkStreamHub`, `sdkFlagsDeps` und die Swagger-Einträge für `/sdk/flags` entfernen.
- [ ] **Step 6:** `schema.prisma`: `FeatureFlag`, `FlagEnvironment`, `TargetingRule`, `RuleCondition`, `FlagType`, `RuleOperator`, `ConditionOperator` und alle Relationen darauf entfernen (`User.createdFlags/updatedFlags`, `Organization`, `Project.featureFlags`, `Brand.flagEnvironments`, `Environment.flagEnvironments`). `ConfigVersion` bleibt.
- [ ] **Step 7:** Module bereinigen: `flags` aus `app.module.ts`; in `brands` alle Flag-Endpunkte/-Methoden und `dto/toggle-brand-flag.dto.ts`; in `projects` `flags-with-brands`, Flag-Import/-Export und Flag-Zählungen; in `environments`/`organizations`/`change-events/project-cleanup.ts` das Anlegen/Löschen von Flag-Zeilen; `access.service.ts`: `assertFlagAccess`; `prisma.service.ts`: Aufrufe der beiden gelöschten Start-Migrationen; `overview` auf die oben genannten Felder kürzen; `seed.ts`: keine Flags mehr anlegen.
- [ ] **Step 8:** Specs der geänderten Dateien anpassen; Specs gelöschter Funktionen löschen.
- [ ] **Step 9:** `cd backend && npx prisma generate && npm run typecheck && npm test && npm run build`. Erwartet: grün.
- [ ] **Step 10:** `grep -rniE "featureflag|flagenvironment|targetingrule|rulecondition|flagtype|evaluat" backend/src backend/prisma/schema.prisma backend/prisma/seed.ts` Erwartet: keine Treffer.
- [ ] **Step 11:** Commit `refactor(backend): remove flags, targeting and sdk evaluation`.

### Task 4: Frontend – Flag-, Experiment- und SDK-Tester-Seiten entfernen

**Files:**
- Delete: `frontend/src/pages/projects/flags/`, `frontend/src/pages/experiments/`, `frontend/src/pages/projects/sdk/`, `frontend/src/components/flags/`, `frontend/src/lib/sdk-tester.ts(+test)`, `frontend/src/lib/targeting-rules.ts(+test)`, `frontend/src/components/routing/LegacyRedirects.tsx(+test)`
- Create: `frontend/src/pages/projects/translations/TranslationsPage.tsx` (Platzhalter), `frontend/src/pages/projects/translations/TranslationsPage.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/lib/routes.ts(+test)`, `frontend/src/components/shell/{ContextNav,Rail,CommandPalette}.tsx(+tests)`, `frontend/src/pages/overview/*`, `frontend/src/pages/projects/brands/BrandDetailPage.tsx(+test)`, `frontend/src/pages/orgs/audit-log/auditLog.ts(+test)`, `frontend/src/pages/orgs/api-keys/CreateApiKeyDialog.tsx`, `frontend/src/pages/orgs/projects/OrgProjectsPage.tsx`, `frontend/src/lib/{permissions,webhooks}.ts`, `frontend/src/i18n/locales/{de,en}.ts`, übrige Treffer aus dem Grep in Step 8

**Interfaces:**
- Produces: `PROJECT_SECTIONS = ['translations', 'environments', 'brands', 'webhooks', 'settings']`; `projectPath(projectId, section = 'translations')`; `getArea` fällt auf `'translations'` zurück; `flagPath` und `experimentPath` existieren nicht mehr. Route `projects/:projectId/translations` rendert `TranslationsPage` (default export).

- [ ] **Step 1: Tests zuerst** – in `frontend/src/lib/routes.test.ts`:

```ts
it('nutzt translations als Standard-Abschnitt', () => {
  expect(projectPath('p1')).toBe('/projects/p1/translations')
  expect(getArea('/projects/p1')).toEqual({ area: 'project', id: 'p1', section: 'translations' })
})
it('behandelt alte Flag-Pfade als translations', () => {
  expect(getArea('/projects/p1/flags')).toEqual({ area: 'project', id: 'p1', section: 'translations' })
})
```

  und `TranslationsPage.test.tsx`: rendert die Seite und erwartet die Überschrift aus dem i18n-Schlüssel `translations.title` („Übersetzungen“ / „Translations“).
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/routes.test.ts` → FAIL.
- [ ] **Step 3:** `routes.ts` umstellen; `App.tsx`: Flag-, Experiment-, SDK-Routen und alle Legacy-Redirect-Routen (`feature-flags`, `experiments`, `sdk-tester`, `organizations/:orgId/projects/:projectId`, `projects/:projectId/brands/:brandId/flags`) entfernen, Route `translations` ergänzen; `projects/:projectId` ohne Abschnitt leitet auf `translations`.
- [ ] **Step 4:** Platzhalterseite: `PageHeader` mit `translations.title` und ein `EmptyState` mit `translations.coming-soon`. Kein Datenabruf.
- [ ] **Step 5:** Navigation (`ContextNav`, `Rail`, `CommandPalette`): Einträge Flags, Experiments, SDK entfernen, „Übersetzungen“ als ersten Projekt-Eintrag. `BrandDetailPage`: Flag-Liste entfernen, Brand-Stammdaten bleiben. `OverviewPage`: nur noch die Felder, die das Backend liefert (Task 3). `auditLog.ts`: Flag-/Experiment-Aktionen aus den Beschriftungen entfernen. `CreateApiKeyDialog`: MCP-Typ entfernen.
- [ ] **Step 6:** `de.ts`/`en.ts`: alle nur von gelöschten Seiten genutzten Schlüssel entfernen; `translations.title`, `translations.coming-soon`, `nav.translations` ergänzen.
- [ ] **Step 7:** `cd frontend && npm run build && npm test && npm run lint:colors`. Erwartet: grün.
- [ ] **Step 8:** `grep -rniE "flag|experiment|sdk-tester|targeting" frontend/src` Erwartet: keine Treffer außer dem Test „behandelt alte Flag-Pfade“ in `routes.test.ts` und dem Webhook-Ereignisnamen `flags.changed` in `lib/webhooks.ts(+test)` (den benennt Plan 2, Task 3 um).
- [ ] **Step 9:** Commit `refactor(frontend): remove flag, experiment and sdk tester pages`.

### Task 5: Umbenennen in Translately

**Files:**
- Modify: alle Dateien mit Treffer bei `grep -rli togglely --exclude-dir=node_modules --exclude-dir=docs --exclude=package-lock.json .` (rund 70 Dateien: `package.json`s, Docker-/Coolify-/nginx-Dateien, `.env*.example`, `scripts/*.sh`, `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.claude/*`, `.github/*`, `backend/src/main.ts`, Mail- und Webhook-Module, `frontend/index.html`, `Logo.tsx`, Stores, `session.ts`, Locales, Tests)

**Interfaces:**
- Produces: Schreibweisen exakt `Translately` (Anzeige), `translately` (Bezeichner, Paket-/Image-/Datenbanknamen, Präfixe). HTTP-Header `X-Togglely-*` → `X-Translately-*`. `localStorage`-/Cookie-Schlüssel `togglely*` → `translately*`. Standard-Datenbankname `translately`.

- [ ] **Step 1: Tests zuerst** – in den vorhandenen Tests die erwarteten Namen umstellen: `frontend/src/lib/session.test.ts` (Schlüsselname), `backend/src/modules/webhooks/webhook-delivery.service.spec.ts` (Header `X-Translately-Signature` bzw. der dort heute geprüfte Header mit neuem Präfix), `frontend/src/pages/auth/LoginPage.test.tsx` (Produktname). `npm test` in beiden Paketen → FAIL an genau diesen Stellen.
- [ ] **Step 2:** Ersetzen in dieser Reihenfolge und Groß-/Kleinschreibung erhaltend: `TOGGLELY` → `TRANSLATELY`, `Togglely` → `Translately`, `togglely` → `translately`. Danach Treffer einzeln durchsehen: Verweise auf `github.com/nuvooo/togglely-sdk` und `togglely-website` samt umgebendem Absatz löschen; `github.com/nuvooo/togglely` → `github.com/nuvooo/translately`.
- [ ] **Step 3:** `README.md` neu fassen: was Translately ist (ein Absatz aus Spec Abschnitt 1), Start per Docker, Hinweis „entstanden als Kopie von Togglely `c0c6f20`“, Abschnitt Webhooks mit dem neuen Header-Namen. Kapitel zu Flags, SDKs, Experiments, MCP entfernen. `CLAUDE.md`: Projektbeschreibung und Tech-Stack-Zeilen zu SDK/Website anpassen.
- [ ] **Step 4:** `Logo.tsx` und `frontend/index.html`: Schriftzug/Titel „Translately“; Farben und Bildmarke unverändert.
- [ ] **Step 5:** Alle drei Prüfbefehle. Erwartet: grün.
- [ ] **Step 6:** `grep -rni togglely --exclude-dir=node_modules --exclude-dir=docs --exclude=package-lock.json .` Erwartet: genau die Herkunftszeilen in `README.md` und `CHANGELOG.md`.
- [ ] **Step 7:** `package-lock.json`s neu erzeugen (`npm install` in Root, `backend`, `frontend`), Prüfbefehle erneut. Commit `chore: rename to translately`.

### Task 6: Startprobe mit Docker

**Files:**
- Modify: nur falls die Probe einen Fehler zeigt

- [ ] **Step 1:** `.env.example` nach `.env` kopieren, `docker compose up -d --build`. Erwartet: alle Container `healthy`/`running`.
- [ ] **Step 2:** `curl -s localhost:<Backend-Port>/health` → `{"status":"ok",…}`.
- [ ] **Step 3:** Im Browser: Setup durchlaufen, einloggen, Organisation und Projekt (einmal SINGLE, einmal MULTI) anlegen, Environment und Brand anlegen und wieder löschen, API-Key anlegen, Webhook anlegen. Erwartet: keine Fehlermeldung, Projekt öffnet die Platzhalterseite „Übersetzungen“.
- [ ] **Step 4:** `docker compose logs backend | grep -iE "error|prisma"` Erwartet: keine Fehler zu fehlenden Modellen.
- [ ] **Step 5:** `docker compose down -v`. Gefundene Fehler beheben, mit eigenem Test absichern, Commit `fix(...)`. Ohne Fehler: kein Commit.
