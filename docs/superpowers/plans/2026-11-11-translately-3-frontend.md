# Translately 3/3 – Oberfläche für Übersetzungen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Übersetzungs-Seite (Variante A: Zeile = Key, Spalte = Sprache, Environment-Tabs, Brand-Auswahl) mit direktem Bearbeiten, Brand-Vererbung, Sprachverwaltung, JSON-Import/-Export, Kopieren zwischen Environments und einem Konfigurationsbeispiel für i18next.

**Architecture:** Alles liegt unter `frontend/src/pages/projects/translations/`. `api.ts` kapselt die HTTP-Aufrufe, der Hook `useTranslations` hält Auswahl (Environment, Brand, Namespace, Suche, Seite) und Tabelle und bietet die Mutationen an; die Komponenten sind reine Darstellung plus Dialoge. Muster (optimistisches Aktualisieren, `busy`-Zeilen, Fehler-Toast und Neuladen, schreibgeschützt für VIEWER) werden von der früheren Flags-Seite übernommen: als Vorlage `togglely/frontend/src/pages/projects/flags/` und `togglely/frontend/src/components/flags/FlagValueRow.tsx` im Togglely-Repo lesen (nur lesen).

**Tech Stack:** React 19, Vite 8, Tailwind 4, Zustand 5, i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-11-translately-design.md` (Abschnitt 8, Mockup `togglely/.superpowers/brainstorm/54-1794411974/content/translations-layout.html`, Variante A)

**Voraussetzung:** Pläne 1 und 2 sind abgeschlossen. Arbeitsordner: `C:\Users\nuVo\Documents\translately`.

## Global Constraints

- Jeder sichtbare Text kommt aus `frontend/src/i18n/locales/de.ts` und `en.ts` (beide pflegen), Schlüssel unter `translations.*`.
- Keine rohen Farben: `npm run lint:colors` muss grün bleiben; vorhandene `components/ui/*`, `components/page/*`, `components/feedback/*`, `components/data/DataTable.tsx` verwenden.
- VIEWER sieht alles schreibgeschützt: keine Eingabefelder, keine Schreib-Buttons.
- Fehlende Texte heißen in der Oberfläche „fehlt“ / „missing“.
- Import und Kopieren zeigen immer erst die Vorschau; ausgeführt wird erst nach Bestätigung.
- Conventional Commits mit der `Co-Authored-By`-Zeile aus `CLAUDE.md`.
- Prüfbefehl: `cd frontend && npm run build && npm test && npm run lint:colors`, im Root `npm run biome:check`.

## Review Focus

- **Schnelles Tippen und Wechseln:** Zelle A speichern, sofort Zelle B bearbeiten → die Antwort von A überschreibt nicht den ungespeicherten Entwurf von B; Antworten für ein inzwischen gewechseltes Environment/Brand werden verworfen (Task 2, 3).
- **Speichern schlägt fehl (Netz, 403, 409):** Entwurf bleibt in der Zelle stehen und ist als Fehler markiert, nichts geht still verloren (Task 3).
- **Keine Sprachen angelegt:** Seite zeigt statt einer leeren Tabelle den Hinweis mit Button „Sprachen verwalten“ (Task 3, 5).
- **Ungültige Importdatei:** kein JSON, Array statt Objekt, über 2 MB → verständliche Meldung im Dialog, keine Anfrage ans Backend (Task 6).
- **Mehrzeilige und sehr lange Texte, Texte mit `<`/`{{…}}`:** werden als reiner Text angezeigt und unverändert gespeichert, die Tabelle bricht nicht aus (Task 3).

---

### Task 1: Typen und API-Schicht

**Files:**
- Create: `frontend/src/pages/projects/translations/types.ts`, `api.ts`, `api.test.ts`

**Interfaces:**
- Consumes: Backend-Routen aus Plan 2 (Tasks 4, 5, 7, 8); `api` aus `@/lib/axios`.
- Produces:

```ts
// types.ts
export interface TableCell { value: string | null; inherited: boolean }
export interface TableRow { keyId: string; key: string; description: string | null; values: Record<string, TableCell> }
export interface TranslationTable { languages: string[]; namespaces: string[]; rows: TableRow[]; total: number; page: number; pageSize: number }
export interface TableQuery { environmentId: string; namespace?: string; brandId?: string; search?: string; missingOnly?: boolean; page?: number; pageSize?: number }
export type SkipReason = 'not_string' | 'empty' | 'invalid_key' | 'too_long' | 'conflict'
export interface ImportTarget { environmentId: string; language: string; namespace?: string; brandId?: string }
export interface ImportPreview { added: string[]; changed: string[]; unchanged: string[]; newKeys: string[]; skipped: { key: string; reason: SkipReason }[] }
export interface CopyPreview { groups: { scope: string; scopeName: string; language: string; namespace: string; added: number; changed: number; unchanged: number; targetOnly: number }[]; totals: { added: number; changed: number; unchanged: number; targetOnly: number }; samples: { added: string[]; changed: string[]; targetOnly: string[] } }

// api.ts
fetchTable(projectId: string, query: TableQuery): Promise<TranslationTable>
createKey(projectId: string, body: { namespace?: string; key: string; description?: string }): Promise<{ id: string; namespace: string; key: string }>
updateKey(keyId: string, body: { key?: string; description?: string | null }): Promise<{ id: string; namespace: string; key: string }>
deleteKey(keyId: string): Promise<void>
setValue(keyId: string, body: { environmentId: string; language: string; brandId?: string; value: string }): Promise<TableCell>
setProjectLanguages(projectId: string, languages: string[]): Promise<{ languages: string[]; removedValues: number }>
setBrandLanguages(brandId: string, languages: string[]): Promise<{ languages: string[]; removedValues: number }>
addNamespace(projectId: string, namespace: string): Promise<{ namespaces: string[] }>
removeNamespace(projectId: string, namespace: string): Promise<{ namespaces: string[]; removedKeys: number }>
previewImport(projectId: string, target: ImportTarget, content: unknown): Promise<ImportPreview>
applyImport(projectId: string, target: ImportTarget, content: unknown): Promise<ImportPreview>
exportFile(projectId: string, target: ImportTarget): Promise<Blob>
previewCopy(projectId: string, sourceEnvironmentId: string, targetEnvironmentId: string): Promise<CopyPreview>
applyCopy(projectId: string, sourceEnvironmentId: string, targetEnvironmentId: string): Promise<CopyPreview>
```

- [ ] **Step 1: Tests** (axios gemockt wie in `frontend/src/lib/api.test.ts`): je Funktion Methode, Pfad und Body/Query; `fetchTable` lässt nicht gesetzte Query-Felder weg; `setValue` entpackt `res.data.cell`; `createKey`/`updateKey` entpacken `res.data.key`; `exportFile` fordert `responseType: 'blob'` an.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS. Commit `feat(translations-ui): api layer and types`.

### Task 2: Hook `useTranslations`

**Files:**
- Create: `frontend/src/pages/projects/translations/useTranslations.ts`, `useTranslations.test.tsx`

**Interfaces:**
- Consumes: `api.ts`; Projekt-/Environment-/Brand-Abruf wie in der früheren `useProjectFlags` (`GET /projects/:id`, Environments und Brands des Projekts); `handleForbidden`, `notifyWriteError` aus `@/lib/permissions`.
- Produces:

```ts
export interface TranslationsSelection { environmentId: string | null; brandId: string | null; namespace: string; search: string; missingOnly: boolean; page: number }
export function cellKey(keyId: string, language: string): string   // `${keyId}:${language}`
export function useTranslations(projectId: string | null): {
  project: { id: string; key: string; type: 'SINGLE' | 'MULTI'; languages: string[]; namespaces: string[] } | null
  environments: { id: string; key: string; name: string }[]
  brands: { id: string; key: string; name: string; languages: string[] }[]
  selection: TranslationsSelection
  select(patch: Partial<TranslationsSelection>): void      // setzt bei Änderung außer `page` die Seite auf 1
  table: TranslationTable | null
  isLoading: boolean
  error: 'not-found' | 'failed' | null
  isBusy(cell: string): boolean
  saveValue(row: TableRow, language: string, value: string): Promise<boolean>   // false bei Fehler
  resetToInherited(row: TableRow, language: string): Promise<boolean>           // setValue mit ''
  createKey(key: string, description?: string): Promise<boolean>
  renameKey(row: TableRow, key: string): Promise<boolean>
  deleteKey(row: TableRow): Promise<boolean>
  reload(): Promise<void>
}
```

Regeln: Startauswahl = erstes Environment (nach `sortOrder`), Brand `null`, Namespace `translation`. Suche wird 300 ms entprellt. Jede Ladeanfrage trägt eine laufende Nummer; Antworten älterer Nummern werden verworfen (wie `loadId` in `useProjectFlags`). `saveValue` aktualisiert die Zelle optimistisch, markiert sie `busy` und übernimmt bei Erfolg die Zelle aus der Antwort, ohne die ganze Tabelle neu zu laden; bei Fehler Toast und Zelle auf den Serverstand zurück, Rückgabe `false`. 409 bei `createKey`/`renameKey` → Toast mit der Meldung des Servers.

- [ ] **Step 1: Tests:** Startauswahl; `select({ environmentId })` lädt neu mit Seite 1; veraltete Antwort wird verworfen (erste Anfrage löst nach der zweiten auf → Tabelle zeigt die zweite); `saveValue` Erfolg ersetzt nur die eine Zelle; `saveValue` Fehler → `false`, Zelle wie vorher, `isBusy` wieder `false`; `resetToInherited` ruft `setValue` mit `''`; Suche löst erst nach 300 ms eine Anfrage aus (Fake-Timer).
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS. Commit `feat(translations-ui): useTranslations hook`.

### Task 3: Seite, Tabelle und Zelle

**Files:**
- Create: `frontend/src/pages/projects/translations/TranslationsTable.tsx`, `TranslationCell.tsx`, `TranslationsToolbar.tsx`, Tests dazu
- Modify: `frontend/src/pages/projects/translations/TranslationsPage.tsx(+test)` (Platzhalter aus Plan 1 ersetzen), `frontend/src/i18n/locales/{de,en}.ts`

**Interfaces:**
- Consumes: `useTranslations`, `cellKey`.
- Produces:

```ts
// TranslationCell.tsx
export function TranslationCell(props: { cell: TableCell; label: string; brandView: boolean; busy: boolean; readOnly: boolean
  onSave(value: string): Promise<boolean>; onReset?(): void }): JSX.Element
// TranslationsTable.tsx
export function TranslationsTable(props: { table: TranslationTable; brandView: boolean; readOnly: boolean; isBusy(cell: string): boolean
  onSave(row: TableRow, language: string, value: string): Promise<boolean>; onReset(row: TableRow, language: string): void
  onRename(row: TableRow): void; onDelete(row: TableRow): void; onPage(page: number): void }): JSX.Element
// TranslationsToolbar.tsx: Environment-Tabs, Brand-Auswahl (nur MULTI), Namespace-Auswahl (nur bei > 1), Suche, Schalter „nur fehlende“, Slots für Aktions-Buttons
```

Verhalten der Zelle:
- Anzeige als reiner Text, `whitespace-pre-wrap`, lange Texte umbrechen; `value === null` → „fehlt“ in Warnfarbe.
- Klick (oder Enter bei Fokus) öffnet ein `textarea` mit dem aktuellen Wert, bei geerbter Zelle vorbefüllt mit dem geerbten Text. Enter speichert, Umschalt+Enter fügt eine Zeile ein, Escape verwirft, Verlassen des Feldes speichert. Unveränderter Wert löst keine Anfrage aus.
- `onSave` liefert `false` → das Feld bleibt offen, der Entwurf bleibt stehen, `aria-invalid="true"`.
- Brand-Sicht: geerbte Zellen abgeschwächt mit Verknüpft-Symbol; eigene Texte hervorgehoben mit Button „Wieder verknüpfen“ (`onReset`). Legende wie `LinkLegend` der früheren Brand-Matrix über der Tabelle.
- `readOnly`: kein Editor, keine Buttons.

Seite: `PageHeader` („Übersetzungen“), Toolbar, Tabelle mit Seitenwechsel (`total`, `pageSize`), Button „Key anlegen“ (Dialog mit Feldern Key und Beschreibung; Fehler vom Server unter dem Feld), Zeilenmenü Umbenennen/Löschen (Löschen mit Rückfrage, nur ADMIN). Zustände: Laden (Skeleton), `not-found`/`failed` (vorhandene Fehlerkomponenten), keine Environments (Hinweis mit Link zur Environment-Seite), keine Sprachen in der gewählten Sicht (`EmptyState` mit Button „Sprachen verwalten“, öffnet in Task 5 den Dialog; bis dahin ohne Aktion), keine Keys (`EmptyState` mit „Key anlegen“ und „JSON importieren“).

- [ ] **Step 1: Tests `TranslationCell.test.tsx`:** zeigt „fehlt“ bei `null`; Enter speichert mit dem getippten Wert; Umschalt+Enter speichert nicht; Escape verwirft und ruft `onSave` nicht; unveränderter Wert ruft `onSave` nicht; `onSave` → `false` lässt den Editor offen mit Entwurf und `aria-invalid`; geerbte Zelle ist vorbefüllt und zeigt keinen „Wieder verknüpfen“-Button; eigene Brand-Zelle zeigt ihn; `readOnly` rendert kein `textarea` nach Klick; Wert `<b>x</b> {{count}}` erscheint wörtlich im DOM (kein `b`-Element).
- [ ] **Step 2: Tests `TranslationsPage.test.tsx`** (Hook bzw. API gemockt): Spalten = Sprachen aus der Tabelle; Wechsel des Environment-Tabs ruft `select`; Brand-Auswahl nur bei MULTI-Projekt; leere Sprachliste → Hinweis statt Tabelle; VIEWER sieht keinen „Key anlegen“-Button; Zelle A speichern (Antwort hängt), Zelle B öffnen und tippen, Antwort A trifft ein → Entwurf in B unverändert.
- [ ] **Step 3:** → FAIL. **Step 4:** Implementieren, Locale-Schlüssel ergänzen. **Step 5:** Prüfbefehl grün.
- [ ] **Step 6:** Im Browser gegen das laufende Backend prüfen (Seed-Projekt): Text ändern, Seite neu laden → Text bleibt; Brand wählen, überschreiben, wieder verknüpfen. Commit `feat(translations-ui): translations table with inline editing`.

### Task 4: Konfigurationsbeispiel und Export

**Files:**
- Create: `frontend/src/pages/projects/translations/DeliverySnippet.tsx(+test)`, `deliveryUrl.ts(+test)`
- Modify: `TranslationsPage.tsx`, Locales

**Interfaces:**
- Produces:

```ts
// deliveryUrl.ts
/** z. B. https://host/sdk/translations/shop/production/{{lng}}/{{ns}}?brandKey=premium */
export function deliveryLoadPath(origin: string, projectKey: string, environmentKey: string, brandKey?: string): string
export function i18nextSnippet(loadPath: string, languages: string[]): string
```

`i18nextSnippet` erzeugt genau diesen Text (Platzhalter ersetzt, `fallbackLng` = erste Sprache der Liste oder `'en'`):

```ts
import i18next from 'i18next'
import HttpBackend from 'i18next-http-backend'

i18next.use(HttpBackend).init({
  fallbackLng: '<erste Sprache>',
  backend: {
    loadPath: '<loadPath>',
    customHeaders: { 'x-api-key': '<YOUR_API_KEY>' },
  },
})
```

- [ ] **Step 1: Tests:** `deliveryLoadPath('https://h', 'shop', 'production')` → `https://h/sdk/translations/shop/production/{{lng}}/{{ns}}`; mit Brand hängt `?brandKey=premium` an; Projekt-/Environment-/Brand-Key werden mit `encodeURIComponent` kodiert, `{{lng}}`/`{{ns}}` nicht; Snippet enthält `loadPath` und `fallbackLng`. Komponente: Button „Für i18next einrichten“ öffnet einen Dialog mit dem Snippet für das gewählte Environment und die gewählte Brand und einem Kopieren-Button; Button „Exportieren“ ist bei mehreren Sprachen ein Menü je Sprache und lädt `<ns>.<lng>.json` herunter.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren (Backend-Origin wie in `togglely/frontend/src/lib/sdk-tester.ts` ermittelt). **Step 4:** Prüfbefehl grün. Commit `feat(translations-ui): i18next setup snippet and export`.

### Task 5: Sprachen und Namespaces verwalten

**Files:**
- Create: `frontend/src/pages/projects/translations/LanguagesDialog.tsx(+test)`, `languages.ts(+test)`
- Modify: `TranslationsPage.tsx`, `frontend/src/pages/projects/brands/BrandDetailPage.tsx(+test)`, `frontend/src/pages/projects/settings/GeneralSection.tsx` oder neue `NamespacesSection.tsx(+test)` in `settings/`, `ProjectSettingsPage.tsx`, Locales

**Interfaces:**
- Produces:

```ts
// languages.ts
export const LANGUAGE_PATTERN: RegExp   // identisch zum Backend: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
export function validateLanguage(code: string, existing: string[]): 'invalid' | 'duplicate' | null
// LanguagesDialog.tsx
export function LanguagesDialog(props: { open: boolean; onOpenChange(open: boolean): void
  scope: { kind: 'project'; id: string } | { kind: 'brand'; id: string; name: string; projectLanguages: string[] }
  languages: string[]; onSaved(languages: string[]): void }): JSX.Element
```

Verhalten: Liste der Sprachen mit Entfernen-Button, Eingabefeld zum Hinzufügen (Validierung sofort). Brand-Variante zeigt zusätzlich die Projektsprachen als anklickbare Vorschläge. Enthält die neue Liste weniger Sprachen als die alte, verlangt Speichern eine Bestätigung: „Texte in <Sprachen> werden gelöscht“ (Brand: „eigene Texte der Brand“). Erreichbar über die Toolbar („Sprachen verwalten“, nur ADMIN; bearbeitet die Sprachen der gewählten Sicht) und auf `BrandDetailPage` als Abschnitt „Sprachen“. Namespaces: Abschnitt in den Projekt-Einstellungen mit Liste, Hinzufügen, Entfernen (mit Rückfrage, nennt die Zahl gelöschter Keys aus der Antwort); `translation` ist nicht entfernbar.

- [ ] **Step 1: Tests:** `validateLanguage` (`'de_DE'` → `invalid`, vorhandener Code → `duplicate`, `'pt-BR'` → `null`); Dialog: Hinzufügen ungültig zeigt Fehler und ruft nichts auf; Entfernen + Speichern zeigt die Bestätigung, erst danach API-Aufruf; Brand-Variante zeigt Projektsprachen als Vorschläge; nach Speichern lädt die Seite die Tabelle neu; Namespaces: `translation` hat keinen Entfernen-Button.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren, den `EmptyState`-Button aus Task 3 anschließen. **Step 4:** Prüfbefehl grün. Commit `feat(translations-ui): manage languages and namespaces`.

### Task 6: Import-Dialog

**Files:**
- Create: `frontend/src/pages/projects/translations/ImportDialog.tsx(+test)`, `readJsonFile.ts(+test)`
- Modify: `TranslationsPage.tsx`, Locales

**Interfaces:**
- Produces:

```ts
// readJsonFile.ts
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export type ReadJsonResult = { ok: true; content: Record<string, unknown> } | { ok: false; error: 'too_large' | 'not_json' | 'not_object' }
export function readJsonFile(file: File): Promise<ReadJsonResult>
// ImportDialog.tsx
export function ImportDialog(props: { open: boolean; onOpenChange(open: boolean): void; projectId: string
  environment: { id: string; name: string }; brand: { id: string; name: string } | null; namespace: string
  languages: string[]; onImported(): void }): JSX.Element
```

Ablauf: (1) Datei wählen und Sprache wählen (Vorauswahl aus dem Dateinamen, wenn er auf `.<lng>.json` endet oder `<lng>.json` heißt und die Sprache in der Liste ist). Ziel-Environment, Brand und Namespace stehen als Text im Dialog (aus der aktuellen Auswahl). (2) Vorschau: Zahlen für neu / geändert / unverändert, aufklappbare Listen (je höchstens 100 Einträge, danach „und n weitere“), Liste der übersprungenen Einträge mit Grund in Klartext. (3) „Importieren“ führt aus, schließt, Toast mit den Zahlen, `onImported`. Hinweistext: „Es wird nichts gelöscht.“ Button „Importieren“ ist deaktiviert, wenn neu + geändert = 0.

- [ ] **Step 1: Tests:** `readJsonFile`: 3 MB → `too_large` ohne die Datei zu parsen; `"[1]"` → `not_object`; `"{"` → `not_json`; gültig → `ok`. Dialog: ungültige Datei zeigt die Meldung und ruft `previewImport` nicht auf; `de.json` wählt `de` vor; Vorschau zeigt Zahlen und Gründe; „Importieren“ ruft `applyImport` mit Ziel und Inhalt, danach `onImported`; nur unveränderte Einträge → Button deaktiviert; 413 vom Server → Meldung „Datei zu groß“.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** Prüfbefehl grün. Commit `feat(translations-ui): json import with preview`.

### Task 7: Kopieren-Dialog

**Files:**
- Create: `frontend/src/pages/projects/translations/CopyDialog.tsx(+test)`
- Modify: `TranslationsPage.tsx`, Locales

**Interfaces:**
- Produces:

```ts
export function CopyDialog(props: { open: boolean; onOpenChange(open: boolean): void; projectId: string
  source: { id: string; name: string }; environments: { id: string; name: string }[]; onCopied(targetEnvironmentId: string): void }): JSX.Element
```

Ablauf: Ziel wählen (alle Environments außer der Quelle; bei nur einem Environment ist der Button „Kopieren nach …“ in der Toolbar deaktiviert mit Tooltip). Nach der Wahl lädt die Vorschau: Summen neu / überschrieben / unverändert / „nur im Ziel, bleibt unverändert“, Tabelle der Gruppen (Sicht, Sprache, Namespace, Zahlen), Beispiele aus `samples`. Bestätigen-Button nennt das Ziel wörtlich („Nach Production kopieren“). Danach Toast und `onCopied`. Nur für MEMBER und höher sichtbar.

- [ ] **Step 1: Tests:** Quelle steht nicht in der Zielauswahl; Vorschau wird erst nach der Zielwahl geladen; Zahlen und „bleibt unverändert“-Zeile erscheinen; Bestätigen ruft `applyCopy(projectId, source.id, target.id)`; neu + überschrieben = 0 → Bestätigen deaktiviert mit Hinweis „Ziel ist bereits aktuell“; VIEWER sieht den Toolbar-Button nicht.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** Prüfbefehl grün. Commit `feat(translations-ui): copy between environments`.

### Task 8: Übersicht, Audit-Log-Beschriftungen und Abnahme

**Files:**
- Modify: `frontend/src/pages/overview/{OverviewPage.tsx,overview.ts}(+test)`, `frontend/src/pages/orgs/audit-log/auditLog.ts(+test)`, `frontend/src/lib/webhooks.ts(+test)`, Locales, `README.md`
- Create: `examples/react-i18next/` (kleine Vite-React-App: `package.json`, `index.html`, `src/main.tsx`, `README.md`)

- [ ] **Step 1: Tests:** Übersicht zeigt pro Projekt Keys, Sprachen und fehlende Texte (`keyCount`, `languageCount`, `missingCount`), „fehlend“ verlinkt auf die Übersetzungs-Seite; `auditLog.ts` liefert Beschriftungen für `translation.key_created`, `key_updated`, `key_deleted`, `value_updated`, `value_deleted`, `imported`, `copied`; Webhook-Ereignis heißt `translations.changed`. → FAIL.
- [ ] **Step 2:** Implementieren. → PASS.
- [ ] **Step 3:** Beispiel-App: liest `VITE_LOAD_PATH` und `VITE_API_KEY`, initialisiert i18next mit `i18next-http-backend` wie im Snippet aus Task 4 und zeigt `t('checkout.title')`, `t('checkout.submit')` sowie einen Sprachumschalter. `README.md` im Root: Abschnitt „In die App einbinden“ mit dem Snippet und Verweis auf das Beispiel.
- [ ] **Step 4: Abnahme gegen die Erfolgskriterien der Spec (Abschnitt 10)** mit `docker compose up -d --build` und der Beispiel-App:
  1. Beispiel-App zeigt die Texte des Seed-Projekts.
  2. Text in der Oberfläche ändern, Beispiel-App neu laden → neuer Text.
  3. Brand mit einer Überschreibung: Beispiel-App mit `?brandKey=` zeigt für diesen Key den Brand-Text, für die anderen den Standard; nicht angebotene Sprache liefert `{}`.
  4. `frontend/src/i18n/locales/de.ts` als JSON importieren, exportieren, vergleichen → inhaltsgleich.
  5. „Kopieren nach Production“ → Beispiel-App gegen `production` zeigt dieselben Texte; ein vorher nur in Production vorhandener Text ist noch da.
  6. Als VIEWER einloggen → keine Eingabefelder, keine Schreib-Buttons.
- [ ] **Step 5:** Alle Prüfbefehle beider Pakete und `npm run biome:check` grün. Commit `feat(translations-ui): overview, audit labels and example app`.
