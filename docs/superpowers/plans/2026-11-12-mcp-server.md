# MCP-Server – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KI-Werkzeuge (Claude, IDE-Agenten) können sich per MCP mit einem Translately-Projekt verbinden und dort Keys anlegen, Texte füllen und fehlende Texte übersetzen lassen.

**Architecture:** Der Vorgänger hatte einen MCP-Server, der in Commit `79e3af3` entfernt wurde; er wird in angepasster Form wiederhergestellt: zustandsloser Streamable-HTTP-Endpunkt `POST /api/mcp` im Backend, Anmeldung per projektgebundenem MCP-API-Key (Bearer), eigene Drosselung. Die Tools rufen die vorhandenen Services (`TranslationsService`, `AiTranslationService`) auf; es gibt keine zweite Schreiblogik.

**Tech Stack:** NestJS 11, Prisma 5, `@modelcontextprotocol/sdk` (wie vor der Entfernung), zod · React 19, i18next, Vitest.

**Spec:** Kein eigenes Design-Dokument; der Auftraggeber hat die Rückfragen übersprungen („mach“). Die Festlegungen unten sind Annahmen von Claude und gelten als Spezifikation. Vorlage im Repo: `git show 79e3af3^:backend/src/modules/mcp/<datei>` und die API-Key-Dateien desselben Stands.

## Festlegungen (Annahmen)

- **Verbindung:** `POST <instanz>/api/mcp`, Header `Authorization: Bearer tkm_…`. Zustandslos, keine Sessions; GET/DELETE antworten 405.
- **MCP-Key:** eigener API-Key-Typ `MCP`, gebunden an genau ein Projekt und an den Nutzer, der ihn anlegt. Gespeichert wird nur der Hash; der Key wird einmal angezeigt. Anlegen auf der API-Keys-Seite der Organisation.
- **Rechte:** Der Key handelt mit der Organisations-Rolle seines Nutzers. Lesen ab VIEWER, Anlegen/Füllen/Übersetzen ab MEMBER, Löschen eines Keys ab ADMIN und nur mit `confirm: true`. Ist der Nutzer deaktiviert oder kein Mitglied mehr, gilt der Key nicht.
- **„Direkt übersetzen“ hat zwei Wege:** (a) Das KI-Werkzeug übersetzt selbst und schreibt mit `set_translations`. (b) `translate_missing` nutzt die KI-Übersetzung der Instanz (nur wenn `ANTHROPIC_API_KEY` gesetzt ist); mit `apply: true` schreibt es die Vorschläge sofort, sonst liefert es sie nur zurück.
- **Schutzregeln bleiben:** `translate_missing` überschreibt nie vorhandene Texte und übernimmt nie Vorschläge mit abweichenden Platzhaltern (sie kommen als `needsReview` zurück). `set_translations` darf überschreiben – das ist der ausdrückliche Auftrag des Aufrufers –, speichert aber nie leere Texte.
- **Nachvollziehbarkeit:** Jede Änderung über MCP steht im Audit-Log mit Name und Id des MCP-Keys.

## Global Constraints

- Backend: kein `import type` (bricht NestJS DI); Biome `useImportType: "off"` bleibt.
- Tool-Fehler: Nur Meldungen von `McpToolError` erreichen den Client; alles andere wird protokolliert und als „Internal error while running tool“ gemeldet (Muster der Vorlage). Keine Prisma-Details, keine API-Keys, keine Texte in Logs.
- Tools arbeiten ausschließlich im Projekt des Keys; jede Abfrage ist an `ctx.projectId` gebunden.
- Der MCP-Key erscheint nie im Klartext in Datenbank, Logs oder Audit-Einträgen (nur Hash bzw. Id/Name).
- Tests sprechen nie mit der echten Claude-API und nie mit einer Datenbank.
- Jeder sichtbare Text kommt aus `frontend/src/i18n/locales/de.ts` und `en.ts`; keine rohen Farben (`npm run lint:colors`).
- Conventional Commits; jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
- Prüfbefehle: `cd backend && npm run build && npm test` · `cd frontend && npm run build && npm test && npm run lint:colors`. Biome: keine neuen Befunde in geänderten Dateien; Formatter nie auf Ordner anwenden.
- Jeder Task endet mit vollständig grünem Build und Tests seiner Seite.

## Review Focus

- **Key eines anderen Projekts/einer anderen Organisation:** Ein MCP-Key sieht und ändert nur sein Projekt; ein Key-Name aus einem anderen Projekt wird als „nicht gefunden“ behandelt (Task 2).
- **Abgelaufener, deaktivierter oder verwaister Key** (Nutzer deaktiviert, Mitgliedschaft entfernt, Projekt gelöscht): 401, keine Daten (Task 1, 2).
- **VIEWER-Key versucht zu schreiben:** klare Tool-Fehlermeldung, nichts geändert (Task 2, 3).
- **KI der Instanz nicht eingerichtet oder überlastet:** `translate_missing` meldet das als lesbaren Tool-Fehler und verweist auf `set_translations`; nichts geschrieben (Task 3).
- **Unsinnige Eingaben des Agenten:** unbekannte Sprache, unbekannter Namespace, ungültiger Key-Name, 500 Einträge auf einmal, leerer Text → lesbarer Tool-Fehler mit dem erlaubten Bereich, nichts teilweise geschrieben, wo die Eingabe als Ganzes ungültig ist (Task 2).

---

### Task 1: MCP-Keys im Backend

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/modules/api-keys/api-keys.service.ts`, `api-keys.controller.ts`, `dto/create-api-key.dto.ts` und Specs; `backend/src/modules/projects/project-cleanup.ts` bzw. die Stelle, die beim Löschen eines Projekts aufräumt (+ Spec)

**Vorlage:** `git show 79e3af3 -- backend/src/modules/api-keys backend/prisma/schema.prisma` zeigt, was entfernt wurde. Übernehmen, was MCP-Keys betrifft; **nicht** übernehmen: `allowedEnvironmentIds`, alles zu Environments, Flags, Experimenten.

**Interfaces – Produces:**
- Prisma: `enum ApiKeyType { SERVER CLIENT SDK MCP }`; `ApiKey.projectId String? @db.ObjectId`, `ApiKey.keyHash String?`, `@@index([keyHash])`. Für MCP-Keys steht in `key` kein verwendbarer Klartext (wie in der Vorlage gelöst).
- `export function hashApiKey(key: string): string` in `api-keys.service.ts` (SHA-256 hex, wie Vorlage).
- Anlegen: bestehende Create-Route mit `{ name, type: 'MCP', projectId, expiresAt? }` → Antwort enthält den Klartext-Key `tkm_<64 hex>` genau einmal; `projectId` ist Pflicht für `MCP` und muss zur Organisation gehören; mindestens Rolle MEMBER in der Organisation (Vorlage prüfen und übernehmen, was dort galt).
- Listen: MCP-Keys erscheinen mit `type: 'MCP'`, `projectId`, `lastUsedAt`, ohne Klartext und ohne Hash.
- Projekt löschen entfernt die MCP-Keys des Projekts.

- [ ] **Step 1:** Specs (aus der Vorlage übernehmen und anpassen): MCP-Key anlegen → Antwort-Key beginnt mit `tkm_`, in der Datenbank steht `keyHash === hashApiKey(key)` und der Klartext nirgends; ohne `projectId` → 400; Projekt einer anderen Organisation → 404; Liste enthält weder `keyHash` noch Klartext; VIEWER darf keinen anlegen; Projekt löschen ruft das Löschen der MCP-Keys des Projekts auf; bestehende Key-Typen verhalten sich unverändert.
- [ ] **Step 2:** `npx jest api-keys projects` → FAIL.
- [ ] **Step 3:** Umsetzen, `npx prisma generate`.
- [ ] **Step 4:** `npm run build && npm test` → grün.
- [ ] **Step 5:** Commit `feat(api-keys): project-bound mcp keys`.

### Task 2: MCP-Endpunkt und Tools für Keys und Texte

**Files:**
- Create: `backend/src/modules/mcp/mcp.module.ts`, `mcp.controller.ts`, `mcp-key.resolver.ts`, `mcp-throttler.guard.ts`, `mcp-server.factory.ts`, `mcp-tools.service.ts` und Specs (Vorlage: gleichnamige Dateien in `79e3af3^`)
- Modify: `backend/package.json` (`@modelcontextprotocol/sdk`), `backend/src/app.module.ts`; Audit-Kontext: falls `shared/actor-context` fehlt, aus `79e3af3^` wiederherstellen und an die Stelle anschließen, an der Audit-Einträge geschrieben werden

**Interfaces – Consumes:** `hashApiKey`, Prisma-Felder aus Task 1; `TranslationsService.getTable/createKey/updateKey/deleteKey/setValue`; `translation-context.ts`.

**Interfaces – Produces:**
```ts
export interface McpContext { apiKeyId: string; apiKeyName: string; userId: string
  organizationId: string; projectId: string; role: OrganizationRole }
export class McpToolError extends Error {}
export function createMcpServer(ctx: McpContext, tools: McpToolsService): McpServer   // name 'translately'
```
Endpunkt, Resolver (Präfix `tkm_`, Typ `MCP`, aktiv, nicht abgelaufen, Nutzer aktiv, Mitglied, Projekt existiert) und Drosselung (600/min pro IP, 120/min pro Key) wie in der Vorlage.

Tools (Eingaben als striktes zod-Schema; `namespace` ist überall optional, Standard ist der Standard-Namespace des Projekts):

| Tool | Eingabe | Ergebnis | Mindestrolle |
|---|---|---|---|
| `get_project` | – | `{ project: {key,name,type}, languages, namespaces, brands: [{key,name,languages}], aiTranslationEnabled, role, canWrite }` | VIEWER |
| `list_keys` | `{ namespace?, search?, missingOnly?, page? }` | `{ keys: [{ key, description, values: Record<lang,string>, missing: string[], brandOverrides: Record<brandKey, Record<lang,string>> }], total, page, pageSize }` (pageSize 50) | VIEWER |
| `get_key` | `{ key, namespace? }` | ein Eintrag wie in `list_keys` | VIEWER |
| `create_key` | `{ key, namespace?, description?, values?: Record<lang,string> }` | `{ key, namespace, written: string[] }` | MEMBER |
| `update_key` | `{ key, namespace?, newKey?, description? }` | `{ key, namespace, description }` | MEMBER |
| `set_translations` | `{ namespace?, brandKey?, entries: [{ key, values: Record<lang,string> }] }` (1..50 Einträge) | `{ written: number, unchanged: number }` | MEMBER |
| `delete_key` | `{ key, namespace?, confirm: boolean = false }` | ohne `confirm`: `{ wouldDelete: { key, texts: number } }`; mit: `{ deleted: true }` | ADMIN |

- `values`/`missing` beziehen sich auf Standardtexte in Projektsprachen; fehlende Sprachen stehen in `missing`, nicht als leerer String in `values`.
- `create_key` mit `values` legt den Key an und schreibt die Texte; ist ein Wert ungültig (Sprache nicht im Projekt, leer, zu lang), wird nichts angelegt.
- `set_translations` prüft zuerst alle Einträge (Key existiert im Namespace, Sprache gehört zur Sicht – bei `brandKey` zur Sprachliste der Brand –, Text nicht leer und ≤ `MAX_VALUE_LENGTH`, keine doppelten Keys); bei einem Fehler wird nichts geschrieben und die Meldung nennt den Eintrag. Geschrieben wird über `TranslationsService.setValue`.
- Fehlermeldungen an den Agenten sind englisch, konkret und nennen erlaubte Werte (z. B. die Projektsprachen).
- `INSTRUCTIONS` des Servers (englisch): ein Projekt pro Key; zuerst `get_project`; vor `create_key` mit `list_keys`+`search` nach vorhandenen Keys suchen; Key-Namen in Punkt-Notation wie die vorhandenen; Platzhalter `{{…}}`, Tags und `$t(…)` unverändert lassen; zum Übersetzen entweder selbst übersetzen und `set_translations` nutzen oder `translate_missing` (Task 3), wenn `aiTranslationEnabled`.
- Annotationen: `readOnlyHint` für die drei Lese-Tools, `destructiveHint` für `delete_key`.
- Audit: Einträge aus MCP-Aufrufen tragen `apiKeyId` und `apiKeyName` des MCP-Keys.

- [ ] **Step 1:** Specs:
  - Resolver: gültiger Key → Kontext; falsches Präfix, unbekannter Hash, Typ ≠ MCP, inaktiv, abgelaufen, Nutzer inaktiv, keine Mitgliedschaft, Projekt fehlt → `UnauthorizedException`; `lastUsedAt` wird höchstens einmal pro Minute geschrieben.
  - Controller: ohne/mit falschem Bearer → 401 mit JSON-RPC-Fehler und `WWW-Authenticate: Bearer`; GET und DELETE → 405.
  - Tools-Service (Fake-Prisma/Fake-Services): `get_project` liefert `canWrite: false` für VIEWER; `list_keys` zeigt fehlende Sprachen in `missing` und Überschreibungen unter dem Brand-Key; `get_key` für einen Key eines anderen Projekts → `McpToolError` „not found“; `create_key` als VIEWER → `McpToolError`, nichts angelegt; `create_key` mit `values` in unbekannter Sprache → Fehler nennt die Projektsprachen, nichts angelegt; `set_translations` mit 51 Einträgen → Fehler; mit einem ungültigen Eintrag unter dreien → nichts geschrieben, Meldung nennt den Key; gültig → `setValue` je Text aufgerufen, `{ written, unchanged }` stimmt; `brandKey` unbekannt → Fehler; `delete_key` ohne `confirm` löscht nicht und nennt die Zahl der Texte; als MEMBER → Fehler; als ADMIN mit `confirm` → gelöscht.
  - Factory: ein unerwarteter Fehler im Tool ergibt `isError` mit „Internal error while running tool“ und nicht die Fehlermeldung.
  - Audit: ein Schreib-Tool erzeugt einen Audit-Eintrag mit `apiKeyId`/`apiKeyName`.
- [ ] **Step 2:** `npx jest modules/mcp` → FAIL.
- [ ] **Step 3:** `npm install @modelcontextprotocol/sdk` in `backend`, umsetzen, Modul registrieren.
- [ ] **Step 4:** `npm run build && npm test` → grün.
- [ ] **Step 5:** Commit `feat(mcp): mcp endpoint with tools for keys and texts`.

### Task 3: Tool `translate_missing`

**Files:**
- Modify: `backend/src/modules/mcp/mcp-tools.service.ts`, `mcp-server.factory.ts`, `mcp.module.ts` und Specs; `backend/src/modules/ai-translation/ai-translation.module.ts` (Service exportieren); `frontend/nginx.conf`, `nginx.conf` (+ vorhandene nginx-Spec)

**Interfaces – Consumes:** `AiTranslationService.previewMissing/suggest/apply`, `AiTranslator.isEnabled`, Fehlercodes aus dem Modul `ai-translation`.

**Interfaces – Produces:**

| Tool | Eingabe | Ergebnis | Mindestrolle |
|---|---|---|---|
| `translate_missing` | `{ sourceLanguage, targetLanguage, namespace?, keys?: string[] (1..40), apply?: boolean = false }` | `{ suggestions: [{ key, source, value }], needsReview: [{ key, source, value, reason: 'placeholders' }], applied: number, skippedExisting: number, remaining: number }` | MEMBER |

- Ohne `keys`: die nächsten bis zu 40 fehlenden Standardtexte der Zielsprache (wie die Sammel-Vorschau); `remaining` nennt den Rest. Mit `keys`: genau diese Keys (unbekannte → Fehler, Keys ohne Quelltext oder mit vorhandenem Zieltext werden ausgelassen).
- `apply: false` schreibt nichts (`applied: 0`). `apply: true` schreibt alle Einträge aus `suggestions` über `AiTranslationService.apply` (überschreibt nie); Einträge aus `needsReview` werden nie geschrieben.
- KI nicht eingerichtet → `McpToolError`: „AI translation is not enabled on this instance. Translate the texts yourself and store them with set_translations.“ Überlastet/abgelehnt/fehlgeschlagen → jeweils eigene lesbare Meldung; nichts geschrieben.
- nginx: `location = /api/mcp` mit `proxy_read_timeout 150s`, sonst wie `/api/` (in beiden Konfigurationen, analog zur vorhandenen KI-Location).
- `INSTRUCTIONS` um einen Satz zu `translate_missing` ergänzen (erst ohne `apply` ansehen, wenn der Nutzer prüfen möchte; `needsReview` nie ungeprüft übernehmen).

- [ ] **Step 1:** Specs: ohne `apply` → Vorschläge, `applied: 0`, `apply` des Services nicht aufgerufen; mit `apply` → Service-`apply` nur mit den Einträgen ohne Platzhalter-Abweichung, `applied`/`skippedExisting` aus dessen Antwort; Abweichung → Eintrag in `needsReview`, nie geschrieben; KI aus → Meldung enthält `set_translations`; `rate_limit` → eigene Meldung; VIEWER → Fehler; 41 Keys → Fehler; unbekannter Key → Fehler; Quelle = Ziel → Fehler. nginx-Spec: beide Konfigurationen haben die Location mit 150 s.
- [ ] **Step 2:** `npx jest modules/mcp nginx` → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** `npm run build && npm test` → grün.
- [ ] **Step 5:** Commit `feat(mcp): translate missing texts through the instance ai`.

### Task 4: MCP-Keys in der Oberfläche und Doku

**Files:**
- Modify: `frontend/src/pages/orgs/api-keys/ApiKeysPage.tsx`, `apiKeys.ts` und Tests (Vorlage: was die Seite vor der Entfernung für MCP-Keys konnte – mit `git log --all --oneline -- frontend/src/pages/orgs/api-keys` den Stand vor der Entfernung finden); `frontend/src/pages/orgs/audit-log/auditLog.ts` falls neue Audit-Aktionen entstanden sind; `frontend/src/i18n/locales/de.ts`, `en.ts`
- Modify: `README.md`, `docs/COOLIFY.md`, `CHANGELOG.md`

**Vorgaben:**
- Beim Anlegen eines API-Keys lässt sich der Typ „MCP“ wählen; dann ist ein Projekt der Organisation zu wählen (Pflicht). Nach dem Anlegen zeigt ein Dialog den Key einmalig mit Kopier-Knopf und dem Hinweis, dass er nicht wieder angezeigt wird, sowie ein kopierbares Konfigurationsbeispiel für MCP-Clients: URL `<Ursprung der Instanz>/api/mcp` und Header `Authorization: Bearer <key>` (als JSON-Block im üblichen `mcpServers`-Format mit `"type": "http"`).
- Die Liste zeigt für MCP-Keys Typ, Projektname und „zuletzt benutzt“.
- Wer keine MCP-Keys anlegen darf (Rolle), sieht die Option nicht.
- README: Abschnitt „MCP“ mit Verbindung, Key anlegen, Liste der Tools mit je einem Satz, Rechte, Hinweis zu `translate_missing` (braucht `ANTHROPIC_API_KEY`; sonst übersetzt das Werkzeug selbst), Sicherheit (Key = Schreibzugriff auf ein Projekt; widerrufen durch Löschen). CHANGELOG-Eintrag im vorhandenen Stil.

- [ ] **Step 1:** Tests: Typ MCP gewählt → Projektauswahl erscheint und ist Pflicht; Create-Request enthält `{ type: 'MCP', projectId }`; der Dialog zeigt den zurückgegebenen Key und ein Snippet mit `/api/mcp` und dem Key; nach Schließen ist der Key nicht mehr im DOM; Liste zeigt Projektname bei MCP-Keys; ohne Recht keine MCP-Option.
- [ ] **Step 2:** `npx vitest run src/pages/orgs/api-keys` → FAIL.
- [ ] **Step 3:** Umsetzen, Doku schreiben.
- [ ] **Step 4:** `npm run build && npm test && npm run lint:colors` → grün.
- [ ] **Step 5:** Commit `feat(api-keys-ui): create mcp keys and show the client configuration`.
