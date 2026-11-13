> Hinweis: Die Abschnitte zu Environments und zum Kopieren zwischen Environments sind durch das Design vom 2026-11-12 ersetzt.

# Translately – Design

Stand: 2026-11-11. Ausgangspunkt ist Togglely auf Commit `c0c6f20`.

Markierung in diesem Dokument: **[Nutzer]** = vom Auftraggeber so entschieden,
**[Annahme]** = von Claude festgelegt und vom Auftraggeber noch nicht bestätigt.

## 1. Absicht

Translately ist ein eigenes, selbst gehostetes Produkt zur Verwaltung von
Übersetzungstexten. Es funktioniert für Texte so, wie Togglely für Feature Flags
funktioniert: Texte werden in einer Oberfläche pro Environment (und optional pro
Brand) gepflegt und von der App des Nutzers zur Laufzeit abgerufen.

Der Grund für den Weg über eine Kopie: Fast alles, was Togglely um die Flags
herum hat (Login, Organisationen, Projekte, Environments, Brands, API-Keys,
Audit-Log, Webhooks, Deployment), wird unverändert gebraucht. Neu gebaut wird
nur der Teil, der heute die Flag-Logik ist. **[Nutzer]**

## 2. Ziele

- Eigenes Repo `translately`, einmalige Kopie von Togglely, danach unabhängige
  Entwicklung. Doppelte Pflege gemeinsamer Teile ist akzeptiert. **[Nutzer]**
- Texte pro Key, Sprache und Environment pflegen. **[Nutzer]**
- Multi-Brand wie bei den Flags: Brand erbt die Standardtexte und kann einzelne
  überschreiben. Jede Brand hat ihre eigenen Sprachen und pro Sprache eine
  eigene Datei. **[Nutzer]**
- Auslieferung per API als JSON, kompatibel mit i18next. Kein SDK. **[Nutzer]**
- Änderungen sind sofort live, kein Veröffentlichen-Schritt. **[Nutzer]**
- Texte per Button von einem Environment in ein anderes kopieren. **[Nutzer]**
- Bestehende Texte per JSON-Upload importieren, pro Sprache und Environment.
  **[Nutzer]**

## 3. Nicht-Ziele (v1)

- Kein SDK, keine Client-Bibliothek. **[Nutzer]**
- Keine A/B-Tests / Experiments. **[Nutzer]**
- Keine Targeting-Regeln, kein An/Aus-Schalter pro Text. **[Annahme]**
- Keine automatische (maschinelle) Übersetzung. **[Annahme]**
- Kein Freigabe- oder Review-Workflow. **[Annahme]**
- Kein Push-Kanal zur App (kein SSE-Stream). Die App sieht neue Texte beim
  nächsten Abruf. **[Annahme]**
- Kein MCP-Server in v1; das Modul `mcp` wird entfernt. **[Annahme]**
- Keine eigene Versions-Historie pro Text; das Audit-Log genügt. **[Annahme]**
- Keine Verbindung zu Togglely zur Laufzeit: eigene Datenbank, eigene Nutzer,
  eigenes Deployment. **[Nutzer: „nicht direkt verbunden“]**

## 4. Anti-Ziele

- Togglely selbst wird nicht verändert. Dieses Dokument liegt nur dort, weil das
  neue Repo noch nicht existiert.
- Kein gemeinsames Paket, kein Monorepo, kein Git-Submodul zwischen den beiden
  Produkten.
- Die Brand-Bedienung darf nicht unübersichtlicher werden als die heutige
  Brand-Matrix („so schön aufgeräumt“). **[Nutzer]**
- Ein Kopieren oder Import darf nie stillschweigend Texte löschen.

## 5. Was aus Togglely übernommen wird

Unverändert bis auf Umbenennung:

- Backend-Module: `auth`, `setup`, `password-reset`, `mail`, `organizations`,
  `projects`, `environments`, `brands`, `api-keys`, `audit-logs`, `webhooks`,
  `health`, `shared/*` (Prisma, Access, Metrics, Mailer)
- Prisma-Modelle: `User`, `Organization`, `OrganizationMember`,
  `OrganizationInvite`, `Project`, `Brand`, `Environment`, `ApiKey`, `AuditLog`,
  `InstanceLock`, `Webhook`, `WebhookDelivery`
- Frontend: App-Shell, Auth-Seiten, Account, Org-Seiten (Liste, Mitglieder,
  Projekte, Einstellungen, API-Keys, Audit-Log), Projekt-Seiten für
  Environments, Brands, Webhooks, Einstellungen (inkl. erlaubte Origins)
- Docker, Coolify, GitHub Actions, `/metrics`, Biome-Konfiguration, Regeln aus
  `CLAUDE.md` und `.claude/`
- Tech-Stack bleibt identisch (NestJS 11, Prisma 5, MongoDB, Redis, React 19,
  Vite 8, Tailwind 4, Zustand 5, i18next).

Entfernt:

- Backend: `flags` (inkl. Targeting-Regeln, Rule-Schedule-Worker),
  `experiments`, `events` (Experiment-Tracking), `mcp`, aus `sdk` alles zur
  Auswertung (`evaluation.service`, `condition-*`, `rule-*`, `sdk-stream`)
- Prisma: `FeatureFlag`, `FlagEnvironment`, `TargetingRule`, `RuleCondition`,
  `Experiment*` sowie die zugehörigen Enums und Relationen. `ConfigVersion`
  bleibt: der Zähler pro Environment speist ETag und Webhooks.
- Frontend: `pages/projects/flags`, `pages/experiments`, `pages/projects/sdk`
  (SDK-Tester), `components/flags`
- Verweise auf das SDK-Repo und die Website in Doku und UI

Angepasst:

- `sdk`-Modul wird zum Auslieferungs-Modul für Übersetzungen. Wiederverwendet
  werden API-Key-Prüfung, Origin-Prüfung, Brand-Ermittlung
  (`sdk-http.utils.ts`), ETag-Logik (`sdk-etag.ts`) und Hashing.
- `change-events` und `overview` zeigen Übersetzungs-Änderungen bzw.
  Kennzahlen zu Keys, Sprachen und fehlenden Übersetzungen statt Flags.
  **[Annahme]**
- `ApiKeyType`: `MCP` entfällt; der Typ für den Lesezugriff der App bleibt.
- Webhooks feuern bei Änderungen an Übersetzungen (Einzeländerung, Import,
  Kopieren) statt bei Flag-Änderungen. **[Annahme]**
- Branding: Name „Translately“ überall (UI-Texte in allen vorhandenen
  UI-Sprachen, Paketnamen, Docker-Images, README, Mail-Vorlagen). Logo und
  Farben: vorerst die von Togglely mit neuem Schriftzug. **[Annahme]**

Das neue Repo startet mit einem einzelnen Anfangs-Commit ohne die
Togglely-Historie; die Commit-Nachricht nennt den Ursprungs-Commit `c0c6f20`.
**[Annahme]**

## 6. Fachmodell

Begriffe:

- **Sprache**: ein Sprachcode wie `de`, `en`, `pt-BR`. Das Projekt hat eine
  Liste von Sprachen. Jede Brand hat eine eigene Liste; sie kann
  Projektsprachen übernehmen und eigene ergänzen. **[Nutzer: Brands haben eigene
  Sprachen; Details Annahme]**
- **Namespace**: i18next-Namespace. Standard ist `translation`. Ein Projekt
  kann mehrere haben. **[Annahme]**
- **Key**: projektweit eindeutig innerhalb eines Namespace, Punkt-Notation
  (`checkout.button.submit`). Entspricht dem heutigen `FeatureFlag`: der Key
  gehört zum Projekt, die Werte hängen an Environments.
- **Text**: der Wert für die Kombination Key × Sprache × Environment ×
  (Standard oder Brand). Entspricht dem heutigen `FlagEnvironment` mit
  optionaler `brandId`, erweitert um die Sprache.

Regeln:

- Ein Text ohne Brand ist der **Standardtext**. Ein Text mit Brand ist eine
  **Überschreibung**. Fehlt die Überschreibung, erbt die Brand den Standardtext
  („verknüpft“). Lösen legt eine Überschreibung an, Verknüpfen löscht sie
  wieder – dieselbe Bedienlogik wie `unlinkBrand`/`relinkBrand` heute.
- Die Sprachliste einer Brand begrenzt auch die Auslieferung: Fragt die App
  einer Brand eine Sprache ab, die die Brand nicht anbietet, bekommt sie eine
  leere Datei (`{}`), auch wenn das Projekt Standardtexte in dieser Sprache
  hat. **[Nutzer]**
- Sprachen sind reine Codes, keine eigenen verknüpften Objekte. Projekt- und
  Brand-Liste sind unabhängige Listen; geerbt wird, wenn der Code in beiden
  steht. Entfernt das Projekt eine Sprache, werden die Standardtexte dieser
  Sprache gelöscht; die Überschreibungen einer Brand, die die Sprache weiter
  anbietet, bleiben erhalten. **[Annahme]**
- Hat eine Brand eine Sprache, die es im Projektstandard nicht gibt, besteht
  ihre Datei nur aus den eigenen Texten der Brand. **[Annahme]**
- Ein leerer Text gilt als „fehlt“ und wird nicht gespeichert. **[Annahme]**
- Ein Key darf nicht gleichzeitig Blatt und Eltern-Knoten sein (`a` und `a.b`),
  weil das im verschachtelten JSON nicht darstellbar ist. Anlegen und Import
  lehnen das mit einer klaren Meldung ab. **[Annahme]**
- Platzhalter und Pluralformen (`{{count}}`, `_one`, `_other`) sind einfach
  Teil von Key bzw. Text und werden unverändert gespeichert und ausgeliefert.
  Keine Validierung in v1. **[Annahme]**
- Löschen eines Keys entfernt ihn mit allen Texten in allen Environments,
  Sprachen und Brands (mit Rückfrage). Löschen eines Environments, einer Brand
  oder einer Sprache entfernt die zugehörigen Texte (wie heute die
  Aufräumlogik bei Flags).
- Rechte wie heute: wer im Projekt nur lesen darf (VIEWER), sieht alles
  schreibgeschützt.

Das konkrete Prisma-Schema (Collections, Indizes) bleibt dem Builder
überlassen, solange die Regeln oben gelten und der Abruf einer Datei ohne
N+1-Abfragen möglich ist.

## 7. Auslieferung an die App

- Ein GET-Endpunkt liefert **eine Datei pro Sprache und Namespace**. Projekt
  und Environment stehen wie beim heutigen `/sdk/flags/:projectKey/:environmentKey`
  im Pfad: `/sdk/translations/:projectKey/:environmentKey/{{lng}}/{{ns}}`.
  Damit lässt sich der Pfad direkt als `loadPath` von `i18next-http-backend`
  verwenden. **[Annahme]**
- Authentifizierung wie heute bei den SDK-Endpunkten: Header `x-api-key` oder
  Query `?apiKey=`; erlaubte Origins des Projekts gelten. Der API-Key bestimmt
  das Environment nicht, er schränkt wie heute nur ein, welche Environments
  abgerufen werden dürfen. An der Key-Erstellung ändert sich nichts.
- Brand über `?brandKey=` (vorhandene Logik). Ohne Brand: Standardtexte. Mit
  Brand: Standardtexte, überlagert von den Überschreibungen der Brand, aber
  nur für Sprachen aus der Sprachliste der Brand; sonst `{}`. Die App bekommt
  immer eine fertig zusammengeführte Datei. **[Nutzer]**
- Antwort ist reines i18next-JSON ohne Hülle, verschachtelt nach Punkt-Notation
  (i18next-Standard). Fehlende Texte fehlen im JSON, damit `fallbackLng` von
  i18next greift. **[Annahme]**
- Unbekannte Sprache oder unbekannter Namespace: `200` mit `{}`, damit i18next
  nicht in Fehlerbehandlung läuft. Ungültiger Key: `401`. **[Annahme]**
- „Sofort live“: Wie bei den Flags gibt es keinen Antwort-Cache auf dem
  Server. Jede Schreiboperation erhöht den vorhandenen Versionszähler des
  Environments (`ConfigVersion`); daraus entsteht das ETag. Antworten tragen
  `Cache-Control: private, no-cache`, sodass Browser immer nachfragen, aber
  bei unverändertem Stand `304` bekommen. **[Annahme]**
- In den Projekt-Einstellungen oder auf der Übersetzungs-Seite steht ein
  kopierbares Konfigurationsbeispiel für `i18next-http-backend`. **[Annahme]**

## 8. Oberfläche

Die Übersetzungs-Seite ersetzt die Flags-Seite als Hauptseite eines Projekts.
Gewählt wurde Variante A aus den Mockups
(`.superpowers/brainstorm/54-1794411974/content/translations-layout.html`):
**[Nutzer]**

- Oben: Tabs für die Environments, Auswahl der Brand („Standard“ plus alle
  Brands; nur bei Multi-Brand-Projekten), rechts die Buttons „JSON
  importieren“ und „Kopieren nach …“.
- Tabelle: Zeile = Key, Spalte = Sprache.

Details **[Annahme]**:

- Zellen sind direkt in der Tabelle bearbeitbar; Speichern beim Verlassen der
  Zelle oder mit Enter, mehrzeilige Texte möglich.
- Fehlende Texte sind sichtbar markiert; Filter „nur fehlende“.
- Suche über Keys und Texte; Namespace-Auswahl, wenn es mehr als einen gibt.
- Bei gewählter Brand: Spalten sind die Sprachen der Brand. Geerbte Texte
  erscheinen abgeschwächt, eigene hervorgehoben, mit derselben
  Verknüpfen/Lösen-Bedienung und Legende wie in der heutigen Brand-Matrix.
- Key anlegen, umbenennen, löschen; Sprachen des Projekts bzw. der Brand
  verwalten (hinzufügen, entfernen).
- Die Tabelle muss mit einigen tausend Keys flüssig bleiben (Paginierung oder
  Virtualisierung, Builder-Entscheidung).
- Export als JSON pro Sprache und Environment (gleiches Format wie die
  Auslieferung).

### Import

- Upload einer JSON-Datei für genau eine Sprache, ein Environment, einen
  Namespace und entweder Standard oder eine Brand. **[Nutzer: pro Sprache und
  Environment; Rest Annahme]**
- Akzeptiert verschachteltes und flaches i18next-JSON. Einträge, die kein
  nicht-leerer String sind (Arrays, Zahlen, `null`, `""`), werden übersprungen
  und in der Vorschau einzeln aufgelistet; der Rest der Datei wird importiert.
  Arrays/Objekte als Werte (`returnObjects`) und bewusst leere Texte werden in
  v1 nicht unterstützt. **[Annahme]**
- Vor dem Übernehmen eine Vorschau: neue Keys, geänderte Texte, unveränderte.
  Der Import legt an und überschreibt, löscht aber nichts. **[Annahme]**

### Kopieren zwischen Environments

- Quelle ist das aktuell gewählte Environment, Ziel wird im Dialog gewählt.
  **[Nutzer: per Button]**
- Kopiert werden alle Sprachen und Namespaces inklusive Brand-Überschreibungen.
  **[Annahme]**
- Vorschau vor dem Ausführen: neu im Ziel, im Ziel geändert, nur im Ziel
  vorhanden. Kopieren ist rein additiv: es legt an und überschreibt; Texte und
  Brand-Überschreibungen, die nur im Ziel existieren, bleiben stehen und
  werden in der Vorschau als „bleibt unverändert“ gezeigt. Eine Option zum
  Entfernen gibt es in v1 nicht. Das Ziel kann danach also mehr enthalten als
  die Quelle. **[Annahme]**

Import und Kopieren landen jeweils als ein Eintrag im Audit-Log und lösen
einen Webhook aus, nicht einen pro Text. **[Annahme]**

## 9. Was dem Builder überlassen ist

- Prisma-Schema und Indizes, genaue API-Pfade und DTOs der Verwaltungs-API
- Grenzen (maximale Key-Länge, Textlänge, Dateigröße beim Import)
- Technik der Tabelle (Paginierung vs. Virtualisierung)
- Reihenfolge der Arbeit; naheliegend ist: Kopie und Entfernen der
  Flag-Teile bis Build und Tests grün sind, dann Modell, Auslieferung,
  Oberfläche, Import, Kopieren.

## 10. Erfolgskriterien

- `backend` und `frontend`: Build, Tests und `npm run biome:check` sind grün,
  ohne verbliebene Flag-, Experiment- oder SDK-Verweise.
- Eine frische Instanz lässt sich per Docker starten, einrichten, und eine
  React-App mit `i18next-http-backend` zeigt Texte aus Translately an.
- Ein in der Oberfläche geänderter Text ist beim nächsten Abruf der App
  sichtbar.
- Eine Brand mit einer Überschreibung liefert für diesen Key den eigenen und
  für alle anderen Keys den Standardtext.
- Ein bestehendes i18next-JSON, das nur nicht-leere String-Werte enthält,
  lässt sich importieren und inhaltsgleich wieder exportieren.
- Nach „Kopieren nach Production“ liefert Production für jeden Text, der in
  der Quelle existiert, denselben Wert wie die Quelle; nichts wurde gelöscht.
