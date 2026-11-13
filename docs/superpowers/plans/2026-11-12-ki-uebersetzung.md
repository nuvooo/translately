# KI-Übersetzung – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fehlende Texte per KI übersetzen lassen: als Vorschlag direkt in einer leeren Zelle und gesammelt für alle fehlenden Standardtexte einer Sprache, jeweils mit Kontrolle vor dem Speichern.

**Architecture:** Neues Backend-Modul `ai-translation` mit einer einzigen Datei, die das Anthropic-SDK kennt (`ai-translator.ts`); der Service wählt Quelltexte aus, ruft den Übersetzer in Blöcken auf, prüft Platzhalter und schreibt nur auf ausdrückliche Bestätigung. Die Oberfläche bekommt einen Vorschlags-Knopf im Zell-Editor und einen Dialog „Mit KI übersetzen“ in der Toolbar.

**Tech Stack:** NestJS 11, Prisma 5, `@anthropic-ai/sdk` + `zod` (neu), Jest · React 19, i18next, Vitest.

**Spec:** Es gibt kein eigenes Design-Dokument; der Auftraggeber hat die Rückfragen übersprungen („mach einfach“). Die Festlegungen unten sind Annahmen von Claude und gelten als Spezifikation. Fachmodell: `docs/superpowers/specs/2026-11-12-ohne-environments-brand-zeilen-design.md`.

## Festlegungen (Annahmen)

- **Anbieter:** Claude-API über das offizielle SDK. Aktiv, sobald `ANTHROPIC_API_KEY` gesetzt ist; sonst ist die Funktion in der Oberfläche unsichtbar und die Routen antworten 503. Modell über `AI_TRANSLATION_MODEL`, Standard `claude-haiku-5-5`.
- **Nie ungefragt schreiben:** Die KI liefert nur Vorschläge. Gespeichert wird in der Zelle erst mit Enter/Verlassen wie bei jedem Text, im Sammel-Dialog erst nach „Übernehmen“.
- **Nie überschreiben:** Das Übernehmen schreibt nur, wo für Key × Sprache × Scope noch kein Text existiert.
- **Sammel-Übersetzung nur für Standardtexte** des gewählten Namespace; Brand-Texte gehen über den Vorschlag in der Zelle.
- **Platzhalter:** `{{name}}`, Tags wie `<0>…</0>`/`<br/>` und `$t(key)` müssen in Quelle und Vorschlag gleich oft vorkommen. Abweichende Vorschläge werden markiert und im Sammel-Dialog standardmäßig nicht übernommen.
- **Rechte:** Vorschlagen und Übernehmen ab MEMBER; VIEWER sieht nichts davon.
- **Datenschutz:** Key-Name, Beschreibung und Quelltext gehen an Anthropic. Das steht in README und `.env.example`.

## Global Constraints

- Backend: kein `import type` (bricht NestJS DI); Biome `useImportType: "off"` bleibt.
- Nur `ai-translator.ts` importiert `@anthropic-ai/sdk`. Tests rufen nie die echte API auf (Client wird injiziert/ersetzt).
- SDK-Aufruf: `client.messages.parse({ model, max_tokens: 16000, output_config: { effort: 'low', format: zodOutputFormat(Schema) }, system, messages })`, `zodOutputFormat` aus `@anthropic-ai/sdk/helpers/zod`, Ergebnis in `response.parsed_output` (kann `null` sein). Kein `thinking`-Parameter, kein `temperature`. Client: `new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 })`. Vor dem Lesen `response.stop_reason` prüfen: `'refusal'` und `'max_tokens'` sind Fehler.
- Fehlerklassen des SDK typisiert abfangen (`Anthropic.AuthenticationError`, `Anthropic.RateLimitError`, `Anthropic.APIError`), nie Fehlermeldungen als Text vergleichen.
- Der API-Key erscheint nie in Logs, Antworten oder Audit-Einträgen.
- Jeder sichtbare Text kommt aus `frontend/src/i18n/locales/de.ts` und `en.ts`; keine rohen Farben (`npm run lint:colors`).
- Ein leerer Text wird nie gespeichert.
- Conventional Commits; jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
- Prüfbefehle: `cd backend && npm run build && npm test` · `cd frontend && npm run build && npm test && npm run lint:colors`. Biome: keine neuen Befunde in geänderten Dateien (das repo-weite `biome:check` ist unabhängig davon rot); Formatter nie auf Ordner anwenden.
- Jeder Task endet mit vollständig grünem Build und Tests seiner Seite.

## Review Focus

- **Kein API-Key gesetzt:** kein Knopf, kein Dialog; direkte Aufrufe der Routen → 503 mit Code `ai_translation_disabled` (Task 1, 2, 3).
- **Die KI liefert Unbrauchbares:** fehlende oder unbekannte Ids, leere Texte, zu lange Texte → diese Einträge werden verworfen, der Rest bleibt; nichts davon wird gespeichert (Task 1, 2).
- **Platzhalter verändert oder übersetzt** (`{{count}}` → `{{Anzahl}}`): Vorschlag ist markiert, im Sammel-Dialog abgewählt (Task 1, 4).
- **Zwischen Vorschlag und Übernehmen hat jemand den Text schon geschrieben:** der vorhandene Text bleibt, die Antwort nennt die Zahl der übersprungenen (Task 2).
- **Anbieter nicht erreichbar, Limit erreicht, Key falsch:** verständliche Meldung im Dialog bzw. an der Zelle, der Entwurf des Nutzers bleibt erhalten (Task 2, 3, 4).

---

### Task 1: Übersetzer, Platzhalter-Prüfung, Modul und Konfiguration

**Files:**
- Create: `backend/src/modules/ai-translation/placeholders.ts` (+ `.spec.ts`), `ai-translator.ts` (+ `.spec.ts`), `ai-translation.module.ts`, `ai-translation.constants.ts`
- Modify: `backend/package.json` (Abhängigkeiten `@anthropic-ai/sdk`, `zod`), `backend/src/app.module.ts`
- Modify: `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml` (Variablen an das Backend durchreichen), `README.md`, `docs/COOLIFY.md`, `CHANGELOG.md`

**Interfaces – Produces:**
```ts
// ai-translation.constants.ts
export const DEFAULT_AI_MODEL = 'claude-haiku-5-5'
export const AI_CHUNK_SIZE = 40          // Texte pro Anfrage an das Modell
export const AI_DISABLED_CODE = 'ai_translation_disabled'

// placeholders.ts
/** Alle Platzhalter eines Textes, sortiert: `{{…}}`, `$t(…)`, öffnende/schließende/selbstschließende Tags. */
export function extractPlaceholders(text: string): string[]
export function samePlaceholders(source: string, translation: string): boolean

// ai-translator.ts
export interface TranslateItem { id: string; key: string; description?: string | null; text: string }
export interface TranslateRequest { sourceLanguage: string; targetLanguage: string; items: TranslateItem[] }
export class AiTranslationUnavailableError extends Error { readonly reason: 'disabled' | 'auth' | 'rate_limit' | 'refused' | 'failed' }
@Injectable() export class AiTranslator {
  isEnabled(): boolean                                   // ANTHROPIC_API_KEY gesetzt und nicht leer
  /** Übersetzt in Blöcken von AI_CHUNK_SIZE; liefert nur Einträge mit bekannter Id und nicht-leerem Text. */
  translate(request: TranslateRequest): Promise<{ id: string; text: string }[]>
}
```
- Der SDK-Client wird über ein Provider-Token `ANTHROPIC_CLIENT` injiziert (Factory: `null` ohne Key), damit Tests einen Fake einsetzen.
- System-Prompt (fest, auf Englisch): Rolle „translator of UI strings for an i18next application“; übersetze von `sourceLanguage` nach `targetLanguage` (BCP-47-Codes); Platzhalter `{{…}}`, `$t(…)` und Tags unverändert und vollständig übernehmen; Key-Name und Beschreibung sind nur Kontext; Ton und Länge einer Bedienoberfläche; für jede Eingabe genau einen Eintrag mit derselben `id` zurückgeben. Die Texte stehen als JSON im User-Turn. Ausgabe-Schema: `{ translations: { id: string; text: string }[] }`.
- Fehlerabbildung: `AuthenticationError`/`PermissionDeniedError` → `auth`; `RateLimitError` → `rate_limit`; `stop_reason === 'refusal'` → `refused`; alles andere (inkl. `parsed_output === null`, `max_tokens`, Netzwerk) → `failed`. Scheitert ein Block, scheitert der ganze Aufruf.
- Doku: neue Variablen `ANTHROPIC_API_KEY` und `AI_TRANSLATION_MODEL` mit dem Hinweis, dass Key-Namen, Beschreibungen und Quelltexte an Anthropic gesendet werden und dass ohne Key nichts gesendet wird.

- [ ] **Step 1:** `placeholders.spec.ts`: `extractPlaceholders('Hallo {{name}}, <0>mehr</0> $t(common.ok)<br/>')` enthält genau `{{name}}`, `<0>`, `</0>`, `$t(common.ok)`, `<br/>`; `samePlaceholders('{{count}} Dateien', '{{count}} files')` ist true; `('{{count}} Dateien', '{{Anzahl}} files')`, `('<0>a</0>', 'a')` und `('{{a}} {{a}}', '{{a}}')` sind false; Texte ohne Platzhalter sind true.
- [ ] **Step 2:** `ai-translator.spec.ts` mit Fake-Client (`messages.parse` als jest.fn): ohne Client `isEnabled()` false und `translate` wirft `AiTranslationUnavailableError` mit `reason: 'disabled'`; 85 Items → 3 Aufrufe (40/40/5), Ergebnis in Eingabe-Reihenfolge; der Aufruf enthält `model: 'claude-haiku-5-5'` (bzw. den Wert aus `AI_TRANSLATION_MODEL`), `output_config.effort: 'low'` und keine Felder `thinking`/`temperature`; Antwort mit unbekannter Id, doppelter Id und leerem Text → nur die gültigen Einträge; `parsed_output: null` → `failed`; `stop_reason: 'refusal'` → `refused`; `new Anthropic.RateLimitError(...)` vom Fake → `rate_limit`; der User-Turn enthält Key-Name und Beschreibung jedes Items.
- [ ] **Step 3:** `npx jest ai-translation` → FAIL.
- [ ] **Step 4:** Abhängigkeiten installieren (`npm install @anthropic-ai/sdk zod` in `backend`), umsetzen, Modul in `app.module.ts` registrieren.
- [ ] **Step 5:** `npm run build && npm test` → grün.
- [ ] **Step 6:** Doku und Compose-Dateien anpassen.
- [ ] **Step 7:** Commit `feat(ai-translation): translator wrapper around the Claude API`.

### Task 2: Service und Routen

**Files:**
- Create: `backend/src/modules/ai-translation/ai-translation.service.ts` (+ `.spec.ts`), `ai-translation.controller.ts` (+ `.spec.ts`), `dto/suggest.dto.ts`, `dto/preview-missing.dto.ts`, `dto/apply.dto.ts`
- Modify: `ai-translation.module.ts`, `backend/src/modules/change-events/change-events.types.ts` (`ChangeAction` um `'ai_translated'`)

**Interfaces – Consumes:** `AiTranslator`, `samePlaceholders` (Task 1); aus `modules/translations`: `translation-context.ts`-Hilfen, `limits.ts` (`DEFAULT_SCOPE`, `DEFAULT_NAMESPACE`, `MAX_VALUE_LENGTH`), Prisma `keyId_language_scope`; `AccessService.assertProjectAccess`, `assertBrandInProject`; `ChangeEventsService.recordChange`; `writeAudit`.

**Interfaces – Produces:**
```ts
// Routen (alle hinter AuthGuard)
GET  ai-translation/status                               -> { enabled: boolean }
POST projects/:projectId/translations/ai/suggest          body SuggestDto        -> SuggestResult        (MEMBER, HTTP 200)
POST projects/:projectId/translations/ai/preview-missing  body PreviewMissingDto -> PreviewMissingResult (MEMBER, HTTP 200)
POST projects/:projectId/translations/ai/apply            body ApplyDto          -> ApplyResult          (MEMBER, HTTP 200)

SuggestDto        { sourceLanguage: string; targetLanguage: string; keyIds: string[] /* 1..50 */; brandId?: string }
SuggestResult     { suggestions: { keyId: string; value: string; placeholderMismatch: boolean }[]; skipped: { keyId: string; reason: 'no_source' }[] }
PreviewMissingDto { namespace?: string; sourceLanguage: string; targetLanguages: string[] /* 1..10 */; limit?: number /* 1..200, Standard 100 */ }
PreviewMissingResult { languages: { language: string; remaining: number;
  suggestions: { keyId: string; key: string; source: string; value: string; placeholderMismatch: boolean }[] }[] }
ApplyDto          { targetLanguage: string; brandId?: string; values: { keyId: string; value: string }[] /* 1..200 */ }
ApplyResult       { written: number; skippedExisting: number }
```
- **Quelltext für `suggest`:** ohne `brandId` der Standardtext in `sourceLanguage`; mit `brandId` die eigene Überschreibung der Brand, sonst der Standardtext (nur wenn `sourceLanguage` Projektsprache ist). Kein Quelltext → `skipped` mit `no_source`. `sourceLanguage === targetLanguage` → 400. Sprachen müssen zur Sicht gehören (Projektsprachen bzw. Sprachen der Brand für das Ziel) → sonst 400. Alle `keyIds` müssen zum Projekt gehören → sonst 404.
- **`previewMissing`:** nur Standardtexte; je Zielsprache die Keys des Namespace (nach Key sortiert), die in `sourceLanguage` einen und in der Zielsprache keinen Standardtext haben; die ersten `limit` werden übersetzt, `remaining` = Rest. Quelle und Ziele müssen Projektsprachen sein, Quelle darf nicht unter den Zielen sein.
- **`apply`:** schreibt je Eintrag nur, wenn für (Key, Sprache, Scope) kein Text existiert (auch bei gleichzeitigem Schreiben: eindeutiger Index, Verletzung zählt als `skippedExisting`). Verwirft nichts stillschweigend: leerer Wert, Wert über `MAX_VALUE_LENGTH`, fremder Key oder Sprache außerhalb der Sicht → 400/404 für die ganze Anfrage, nichts geschrieben. Bei `written > 0`: ein `recordChange` mit einer Change `{ language, action: 'ai_translated' }` und ein Audit-Eintrag `translation.ai_translated`, `entityType: 'Project'`, `newValues: { language, scope, count: written }`. `apply` ruft die KI nicht auf und funktioniert auch ohne API-Key.
- **KI nicht nutzbar:** `disabled` → 503 mit `{ code: 'ai_translation_disabled' }`; `auth` → 503 `{ code: 'ai_translation_auth' }`; `rate_limit` → 429 `{ code: 'ai_translation_rate_limit' }`; `refused`/`failed` → 502 `{ code: 'ai_translation_failed' }`. Form der Fehlerantwort wie bei den bestehenden Fehlern mit `code` (siehe Webhooks-Modul).
- **Drosselung:** `suggest` und `preview-missing` höchstens 20 Aufrufe pro Minute und Nutzer über `@nestjs/throttler` nach dem Muster in `auth.controller.ts`.

- [ ] **Step 1:** Service-Tests (Fake-Prisma nach dem Muster von `translations.service.spec.ts`, Fake-`AiTranslator`):
  - `suggest` Standard: 2 Keys, einer ohne Quelltext → 1 Vorschlag, 1 `skipped`; der Übersetzer bekommt nur den mit Quelltext, samt Key-Name und Beschreibung.
  - `suggest` Brand: Überschreibung in der Quellsprache vorhanden → sie ist die Quelle, nicht der Standardtext.
  - `suggest`: Vorschlag `'{{Anzahl}} Dateien'` zu Quelle `'{{count}} files'` → `placeholderMismatch: true`.
  - `suggest`: Quelle = Ziel → `BadRequestException`; Key eines anderen Projekts → `NotFoundException`; Zielsprache nicht in der Brand-Liste → `BadRequestException`.
  - `previewMissing`: 5 Keys, 3 fehlen in `fr`, `limit: 2` → 2 Vorschläge, `remaining: 1`, sortiert nach Key; Key ohne Quelltext zählt nicht.
  - `apply`: 3 Werte, einer existiert bereits → `{ written: 2, skippedExisting: 1 }`, vorhandener Text unverändert, genau ein `recordChange` und ein Audit-Eintrag mit `count: 2`.
  - `apply`: Verletzung des eindeutigen Index (P2002) beim Schreiben → zählt als `skippedExisting`, kein Fehler.
  - `apply`: leerer Wert → `BadRequestException`, nichts geschrieben; alle vorhanden → `{ written: 0, … }`, kein `recordChange`, kein Audit.
  - Übersetzer wirft `rate_limit` → `suggest` reicht die passende HTTP-Ausnahme mit Code `ai_translation_rate_limit` durch.
- [ ] **Step 2:** Controller-Tests: `status` liefert `{ enabled: false }` ohne Key; VIEWER bekommt 403 auf `suggest`, `preview-missing` und `apply`; Brand eines anderen Projekts → 404; `keyIds` mit 51 Einträgen → 400; `suggest` ohne Key → 503 mit `code: 'ai_translation_disabled'`.
- [ ] **Step 3:** `npx jest ai-translation` → FAIL.
- [ ] **Step 4:** Umsetzen.
- [ ] **Step 5:** `npm run build && npm test` → grün.
- [ ] **Step 6:** Commit `feat(ai-translation): suggest, preview and apply routes`.

### Task 3: Vorschlag in der Zelle

**Files:**
- Modify: `frontend/src/pages/projects/translations/api.ts` (+ Test), `TranslationCell.tsx` (+ Test), `TranslationsTable.tsx` (+ Test), `BrandRows.tsx`, `TranslationsPage.tsx` (+ Test), `types.ts`
- Create: `frontend/src/pages/projects/translations/useAiTranslation.ts` (+ Test)
- Modify: `frontend/src/pages/orgs/audit-log/auditLog.ts` (+ Test), `frontend/src/i18n/locales/de.ts`, `en.ts`

**Interfaces – Consumes:** Routen aus Task 2.

**Interfaces – Produces:**
```ts
// types.ts
export interface AiSuggestion { keyId: string; value: string; placeholderMismatch: boolean }

// api.ts
fetchAiStatus(): Promise<{ enabled: boolean }>
suggestTranslations(projectId: string, body: { sourceLanguage: string; targetLanguage: string; keyIds: string[]; brandId?: string }):
  Promise<{ suggestions: AiSuggestion[]; skipped: { keyId: string; reason: 'no_source' }[] }>

// useAiTranslation.ts
/** Lädt den Status einmal; `enabled` ist false, solange er lädt oder die Abfrage scheitert. */
export function useAiTranslation(projectId: string | null): {
  enabled: boolean
  /** null = kein Vorschlag möglich (keine Quelle); wirft nie, Fehler werden als Toast gemeldet und ergeben null. */
  suggest(row: TableRow, targetLanguage: string, sourceLanguage: string, brandId?: string | null): Promise<AiSuggestion | null>
}

// TranslationCell.tsx – neue Prop
onSuggest?(): Promise<{ value: string; placeholderMismatch: boolean } | null>

// TranslationsTable.tsx – neue Prop
/** Fehlt die Prop, gibt es keinen Vorschlags-Knopf. */
onSuggest?(row: TableRow, targetLanguage: string, sourceLanguage: string, brandId?: string | null): Promise<AiSuggestion | null>
```
- **Wo der Knopf erscheint:** nur im **offenen Editor** einer Zelle ohne eigenen Text (Standard: fehlt; Brand: fehlt oder geerbt), nur wenn `onSuggest` gesetzt ist und es eine Quellsprache gibt. Die geschlossene Tabelle bleibt unverändert kompakt.
- **Quellsprache** (bestimmt die Tabelle): die erste Projektsprache ≠ Zielsprache, in der die Zeile einen Standardtext hat; für Brand-Zellen zusätzlich Sprachen, in denen die Brand eine eigene Überschreibung hat (diese zuerst). Keine → kein Knopf.
- **Verhalten:** Klick lädt (Knopf zeigt Spinner, Editor bleibt bedienbar), danach steht der Vorschlag im Entwurf und gilt als vom Nutzer geändert (wird also bei Enter/Verlassen gespeichert). Hat der Nutzer inzwischen selbst getippt, wird der Entwurf **nicht** überschrieben. `placeholderMismatch` → Hinweiszeile unter dem Editor. Antwort `null` → nichts ändert sich. Während der Vorschlag lädt, speichert das Verlassen des Feldes nicht (sonst ginge der Vorschlag ins Leere).
- Fehler-Toasts nach Code: `ai_translation_rate_limit`, `ai_translation_auth`/`ai_translation_disabled`, sonst allgemein.
- Audit-Log: Aktion `translation.ai_translated` in `KNOWN_ACTIONS` mit Beschriftung.
- Locale-Schlüssel (de / en):
  - `translations.ai.suggest`: „KI-Vorschlag“ / “AI suggestion”
  - `translations.ai.suggesting`: „Vorschlag wird erstellt …“ / “Creating suggestion …”
  - `translations.ai.placeholder-warning`: „Platzhalter weichen vom Quelltext ab – bitte prüfen.“ / “Placeholders differ from the source text – please check.”
  - `translations.ai.error-rate-limit`: „Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.“ / “The AI service is busy right now. Please try again in a moment.”
  - `translations.ai.error-config`: „Die KI-Übersetzung ist auf dieser Instanz nicht richtig eingerichtet.“ / “AI translation is not set up correctly on this instance.”
  - `translations.ai.error`: „Der Vorschlag konnte nicht erstellt werden.“ / “The suggestion could not be created.”
  - Audit: „Texte per KI übersetzt“ / “Texts translated by AI” (Schlüssel nach dem Muster der vorhandenen Audit-Aktionen)

- [ ] **Step 1:** Tests:
  - `TranslationCell.test`: ohne `onSuggest` kein Knopf; mit `onSuggest` und fehlendem Text: Editor öffnen, Knopf klicken → Textfeld enthält den Vorschlag, Enter ruft `onSave` mit dem Vorschlag; `placeholderMismatch: true` → Warnzeile sichtbar; Nutzer tippt, bevor die Antwort kommt → Entwurf bleibt der getippte Text; `onSuggest` liefert `null` → Entwurf unverändert; Zelle mit eigenem Text → kein Knopf.
  - `TranslationsTable.test`: Zeile mit `de`-Text und fehlendem `en` → Knopf im `en`-Editor ruft `onSuggest(row, 'en', 'de', undefined)`; Zeile ohne irgendeinen Text → kein Knopf; Brand-Zelle → `onSuggest(row, lang, source, brandId)`; `readOnly` → kein Knopf.
  - `useAiTranslation.test`: Status `enabled: false` → `enabled` false; `suggest` gibt den ersten Vorschlag zurück; Antwort nur `skipped` → `null`; 429 mit Code → Toast mit `error-rate-limit`, Rückgabe `null`.
  - `TranslationsPage.test`: bei `enabled: false` und für VIEWER wird der Tabelle kein `onSuggest` übergeben.
  - `api.test`: Pfade und Bodies der beiden Funktionen. `auditLog.test`: neue Aktion bekannt und beschriftet.
- [ ] **Step 2:** `npx vitest run src/pages/projects/translations src/pages/orgs/audit-log` → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** `npm run build && npm test && npm run lint:colors` → grün.
- [ ] **Step 5:** Commit `feat(translations-ui): ai suggestion in the cell editor`.

### Task 4: Dialog „Mit KI übersetzen“

**Files:**
- Create: `frontend/src/pages/projects/translations/AiTranslateDialog.tsx` (+ `.test.tsx`)
- Modify: `api.ts` (+ Test), `types.ts`, `TranslationsDialogs.tsx`, `TranslationsPage.tsx` (+ Test), `frontend/src/i18n/locales/de.ts`, `en.ts`

**Interfaces – Consumes:** Routen `preview-missing` und `apply` (Task 2); `useAiTranslation().enabled` (Task 3).

**Interfaces – Produces:**
```ts
// types.ts
export interface AiPreviewLanguage { language: string; remaining: number
  suggestions: { keyId: string; key: string; source: string; value: string; placeholderMismatch: boolean }[] }

// api.ts
previewMissingTranslations(projectId: string, body: { namespace?: string; sourceLanguage: string; targetLanguages: string[]; limit?: number }):
  Promise<{ languages: AiPreviewLanguage[] }>
applyAiTranslations(projectId: string, body: { targetLanguage: string; brandId?: string; values: { keyId: string; value: string }[] }):
  Promise<{ written: number; skippedExisting: number }>

// AiTranslateDialog.tsx
export function AiTranslateDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  projectId: string
  namespace: string
  projectLanguages: string[]
  /** Nach erfolgreichem Übernehmen (mindestens ein Text geschrieben). */
  onApplied(): void
}): JSX.Element
```
- **Knopf** „Mit KI übersetzen“ in den Toolbar-Aktionen der Seite: nur bei `canEdit`, `enabled` und mindestens zwei Projektsprachen.
- **Schritt 1:** Quellsprache (Auswahl, Start: erste Projektsprache), Zielsprachen (Checkboxen, alle übrigen Projektsprachen, Start: alle angewählt), Hinweis, dass nur fehlende Standardtexte im Namespace `<name>` übersetzt und Texte dafür an den KI-Dienst gesendet werden. Knopf „Vorschläge erstellen“.
- **Schritt 2:** je Zielsprache ein Abschnitt mit Liste (Key, Quelltext, Vorschlag) und Checkbox je Zeile; Zeilen mit `placeholderMismatch` sind markiert und abgewählt, alle anderen angewählt. Bei `remaining > 0` der Hinweis mit der Zahl. Sprache ohne fehlende Texte: „Nichts zu übersetzen“. Knöpfe „Zurück“ und „Übernehmen (N)“; N = angewählte Zeilen, bei 0 gesperrt.
- **Übernehmen:** ein `apply` je Sprache mit angewählten Zeilen, nacheinander. Danach Toast mit Summe geschrieben/übersprungen, `onApplied()` (Seite lädt neu) und Dialog schließt. Scheitert eine Sprache, bleiben die Vorschläge der noch nicht übernommenen Sprachen stehen, bereits übernommene Abschnitte verschwinden, und der Fehler steht im Dialog.
- Der Dialog hält seine Auswahl beim Öffnen fest (Schnappschuss von Namespace und Sprachen), lässt sich während einer laufenden Anfrage nicht schließen und verwirft beim Schließen alle Vorschläge.
- Fehlermeldungen nach Code wie in Task 3 (dieselben Schlüssel), angezeigt im Dialog.
- Locale-Schlüssel (de / en):
  - `translations.ai.translate`: „Mit KI übersetzen“ / “Translate with AI”
  - `translations.ai.dialog.title`: „Fehlende Texte mit KI übersetzen“ / “Translate missing texts with AI”
  - `translations.ai.dialog.intro`: „Übersetzt werden nur fehlende Standardtexte im Namespace „{{namespace}}“. Key-Namen, Beschreibungen und Quelltexte werden dafür an den KI-Dienst gesendet. Gespeichert wird erst nach deiner Bestätigung.“ / “Only missing default texts in the namespace “{{namespace}}” are translated. Key names, descriptions and source texts are sent to the AI service for this. Nothing is saved until you confirm.”
  - `translations.ai.dialog.source`: „Quellsprache“ / “Source language”
  - `translations.ai.dialog.targets`: „Zielsprachen“ / “Target languages”
  - `translations.ai.dialog.create`: „Vorschläge erstellen“ / “Create suggestions”
  - `translations.ai.dialog.creating`: „Vorschläge werden erstellt …“ / “Creating suggestions …”
  - `translations.ai.dialog.nothing`: „Nichts zu übersetzen“ / “Nothing to translate”
  - `translations.ai.dialog.remaining`: „{{count}} weitere fehlende Texte folgen in einem nächsten Durchgang.“ / “{{count}} more missing texts follow in a next run.”
  - `translations.ai.dialog.apply`: „Übernehmen ({{count}})“ / “Apply ({{count}})”
  - `translations.ai.dialog.col-key` „Key“ / “Key”, `col-source` „Quelltext“ / “Source text”, `col-suggestion` „Vorschlag“ / “Suggestion”
  - `translations.ai.dialog.toast-applied`: „{{written}} Texte übernommen, {{skipped}} übersprungen (bereits vorhanden).“ / “{{written}} texts applied, {{skipped}} skipped (already present).”

- [ ] **Step 1:** `AiTranslateDialog.test.tsx`: Start zeigt Quelle `de`, Ziele `en` und `fr` angewählt; Quelle auf `en` → `en` verschwindet aus den Zielen, `de` kommt dazu; „Vorschläge erstellen“ sendet `{ namespace, sourceLanguage, targetLanguages }`; Vorschau zeigt Keys, Quelltexte, Vorschläge; Zeile mit `placeholderMismatch` ist abgewählt und markiert; `remaining: 7` → Hinweis mit 7; „Übernehmen (2)“ sendet je Sprache nur die angewählten Zeilen, ruft `onApplied` und schließt; alle abgewählt → Knopf gesperrt; 429 beim Erstellen → Meldung `error-rate-limit` im Dialog, Schritt 1 bleibt; `apply` scheitert bei der zweiten Sprache → erste verschwindet, zweite bleibt mit Fehlermeldung, `onApplied` wurde trotzdem aufgerufen (es wurde ja geschrieben); während des Erstellens lässt sich der Dialog nicht schließen.
- [ ] **Step 2:** `TranslationsPage.test`: Knopf „Mit KI übersetzen“ nur bei `enabled`, `canEdit` und ≥ 2 Projektsprachen; `api.test`: Pfade und Bodies.
- [ ] **Step 3:** `npx vitest run src/pages/projects/translations` → FAIL.
- [ ] **Step 4:** Umsetzen.
- [ ] **Step 5:** `npm run build && npm test && npm run lint:colors` → grün.
- [ ] **Step 6:** Commit `feat(translations-ui): translate missing texts with ai`.
