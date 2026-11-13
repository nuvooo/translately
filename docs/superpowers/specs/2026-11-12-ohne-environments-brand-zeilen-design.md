# Translately ohne Environments, Brands als aufklappbare Zeilen – Design

Stand: 2026-11-12. Baut auf `2026-11-11-translately-design.md` auf und ersetzt
dort alles, was Environments, das Kopieren zwischen Environments und die
Brand-Auswahl über der Tabelle betrifft. Wo sich beide Dokumente
widersprechen, gilt dieses.

Markierung: **[Nutzer]** = vom Auftraggeber so entschieden, **[Annahme]** = von
Claude festgelegt und vom Auftraggeber noch nicht bestätigt.

## 1. Absicht

Die Übersetzungs-Seite ist mit Environment-Tabs und Brand-Auswahl zu
umständlich geworden. Zwei Dinge ändern sich:

1. **Environments gibt es nicht mehr**, nirgends im Produkt. Ein Text ist in
   einem Projekt genau einmal gespeichert. **[Nutzer: „Die Environments
   brauchen wir gar nicht mehr“]**
2. **Die Tabelle wird wieder kompakt**: eine Zeile pro Key mit den
   Standardtexten; aufgeklappt zeigt die Zeile darunter je Brand eine Zeile, in
   der man den Text der Brand direkt anpasst. Brands erben den Standardtext und
   lassen sich lösen und wieder verknüpfen wie bei Togglely. **[Nutzer]**

## 2. Ziele

- Text = Key × Sprache × (Standard oder Brand). Kein Environment mehr im
  Datenmodell, in der Verwaltungs-API, in der Auslieferung und in der
  Oberfläche. **[Nutzer]**
- Auf der Übersetzungs-Seite lässt sich der Text einer Brand ändern, ohne die
  Ansicht zu wechseln: Zeile aufklappen, Zelle bearbeiten. **[Nutzer]**
- Verknüpfen/Lösen pro Text einer Brand, mit eigener Logik im Backend
  („link/unlink service“). **[Nutzer]**

## 3. Nicht-Ziele

- Kein Ersatz für Environments (keine Entwürfe, kein „Staging“-Stand, kein
  Veröffentlichen-Schritt). Eine Änderung ist sofort für alle live.
  **[Annahme]**
- Kein Verknüpfen/Lösen für eine ganze Brand oder eine ganze Zeile auf einmal;
  nur pro Text. **[Annahme]**
- Kein „alle aufklappen“. **[Annahme]**

## 4. Anti-Ziele

- Die Tabelle darf durch die Brands nicht breiter oder unruhiger werden als die
  heutige Standardansicht: zugeklappt sieht man von den Brands nur einen
  kleinen Hinweis.
- Kein Rest von Environments, der Nutzer verwirrt: keine Seite, kein
  Menüpunkt, kein Feld in Formularen, kein Wort in den UI-Texten.
- Beim Umstellen vorhandener Daten gehen keine Texte stillschweigend verloren
  (siehe 9).

## 5. Fachmodell

- **Text**: Wert für Key × Sprache × Scope; Scope ist `default` oder die Id
  einer Brand. Eindeutig über (Key, Sprache, Scope).
- **Standardtext** = Text mit Scope `default`. **Überschreibung** = Text mit
  Brand-Scope. Fehlt die Überschreibung, erbt die Brand den Standardtext
  („verknüpft“).
- **Lösen**: legt für Key × Sprache × Brand eine Überschreibung an, Startwert
  ist der aktuelle Standardtext. Ist der Standardtext leer, entsteht noch
  nichts; die Überschreibung entsteht erst mit dem ersten gespeicherten Text
  (ein leerer Text wird weiterhin nicht gespeichert). **[Annahme]**
- **Verknüpfen**: löscht die Überschreibung; die Brand zeigt wieder den
  Standardtext.
- Einen geerbten Text direkt zu überschreiben ist dasselbe wie Lösen plus
  Speichern. Eine Überschreibung leer zu speichern ist dasselbe wie
  Verknüpfen. **[Annahme]**
- Sprachlisten von Projekt und Brand, Namespaces, Key-Regeln und Rechte
  bleiben wie im Design vom 2026-11-11.
- Der Versionszähler für das ETag (`ConfigVersion`) zählt pro Projekt statt
  pro Projekt und Environment.

## 6. Backend

Entfernt:

- Modul `environments` samt Controller, DTOs, Sortierung; Prisma-Modell
  `Environment` und alle Relationen darauf.
- `TranslationValue.environmentId`, `ApiKey.environmentId`,
  `Webhook.environmentIds`, `ConfigVersion.environmentId`.
- Kopieren zwischen Environments: `translation-copy.service`, die Routen
  `translations/copy` und `translations/copy/preview`, zugehörige DTOs und
  Tests.
- Anlegen von Standard-Environments beim Setup und beim Anlegen eines
  Projekts; Environment-Zähler in `overview`; Environment in Change-Events,
  Webhook-Payloads und Audit-Log-Einträgen.

Angepasst:

- Alle Verwaltungs-Routen für Texte (Tabelle, Wert setzen, Import, Export)
  verlieren den Parameter `environmentId`.
- **Auslieferung**: `/sdk/translations/:projectKey/{{lng}}/{{ns}}`, Brand
  weiter über `?brandKey=`. Der alte Pfad mit Environment entfällt ohne
  Weiterleitung, da es noch keine veröffentlichte Version gibt. **[Annahme]**
- **API-Keys** gelten für alle Projekte der Organisation wie bisher ein Key
  ohne Environment-Einschränkung. **[Annahme]**
- **Webhooks** feuern bei jeder Text-Änderung des Projekts; die Auswahl von
  Environments entfällt.
- **Overview**: „fehlende Texte“ = Keys × Projektsprachen ohne Standardtext.
- **Tabellen-Abfrage**: liefert pro Seite die Keys mit Standardtexten und – bei
  Multi-Brand-Projekten – die Überschreibungen aller Brands für genau diese
  Keys in derselben Antwort. Aufklappen löst keinen weiteren Request aus.
  Geerbte Werte werden nicht mitgeschickt; die Oberfläche leitet sie aus dem
  Standardtext ab. **[Annahme]**

Neu – Verknüpfen/Lösen:

- Eigener Service im Modul `translations` mit zwei Operationen pro
  Key × Sprache × Brand: `unlink` (Überschreibung mit dem Standardtext
  anlegen, gibt den neuen Zellzustand zurück) und `link` (Überschreibung
  löschen). Beide prüfen, dass die Sprache in der Sprachliste der Brand steht,
  schreiben einen Audit-Log-Eintrag, erhöhen den Versionszähler und lösen den
  Webhook aus. Beide sind idempotent.
- Zwei Routen dafür; genaue Pfade und DTOs sind Builder-Sache.

## 7. Oberfläche

### Übersetzungs-Seite

Über der Tabelle (eine Zeile, wie heute ohne Tabs und ohne Brand-Auswahl):
Namespace-Auswahl (nur bei mehr als einem), Suche, Schalter „nur fehlende“,
rechts „Sprachen verwalten“, „JSON importieren“, Einrichtungs-Snippet,
Export. „Kopieren nach …“ entfällt.

Tabelle:

- Zeile = Key, Spalte = Sprache; Zellen zeigen und bearbeiten die
  Standardtexte wie heute.
- Bei Multi-Brand-Projekten mit mindestens einer Brand hat jede Zeile links
  einen Pfeil. Zugeklappt steht neben dem Key ein kleiner Hinweis, wie viele
  Brands eigene Texte für diesen Key haben (nichts, wenn keine). **[Annahme]**
- Aufgeklappt folgt unter der Zeile je Brand eine niedrigere, leicht
  eingerückte und abgesetzte Zeile: links der Brandname, daneben dieselben
  Sprachspalten.
- Zelle einer Brand-Zeile, drei Zustände:
  - **geerbt**: Standardtext abgeschwächt mit Ketten-Symbol. Klick auf das
    Symbol löst (Text wird eigener Text und steht zum Bearbeiten bereit);
    direktes Hineinschreiben und Speichern löst ebenfalls.
  - **eigen**: Text normal mit farbigem Strich am Rand; ein Knopf „wieder
    verknüpfen“ stellt den Standardtext her.
  - **Sprache nicht in der Sprachliste der Brand**: leer, gesperrt, mit
    Tooltip.
- Legende (Kette = geerbt, Strich = eigen) über der Tabelle, sobald das
  Projekt Brands hat.
- Spalten sind die Projektsprachen, danach Sprachen, die nur Brands anbieten.
  In einer solchen Spalte ist die Standardzelle gesperrt. Das ist die eine
  bewusste Ausnahme vom Anti-Ziel „nicht breiter“: die Spalten stehen immer
  da, damit die Tabelle beim Aufklappen nicht springt. **[Annahme]**
- Mehrere Zeilen können gleichzeitig aufgeklappt sein. Der Zustand bleibt bei
  Suche und Filter erhalten und wird beim Wechsel von Seite oder Namespace
  zurückgesetzt. **[Annahme]**
- Der Pfeil ist per Tastatur bedienbar und trägt `aria-expanded`.
- Single-Brand-Projekte: kein Pfeil, keine Legende, sonst gleich.
- „Nur fehlende“ bezieht sich auf Standardtexte in Projektsprachen. Die Suche
  durchsucht Keys, Standardtexte und Überschreibungen; trifft sie nur eine
  Überschreibung, erscheint die Zeile trotzdem (zugeklappt, mit Hinweis).
  **[Annahme]**
- Speichern, Sperren während des Ladens und die Reihenfolge überlappender
  Speichervorgänge verhalten sich für Brand-Zellen wie heute für Zellen.

Dialoge, die bisher die gewählte Brand aus der Ansicht nahmen, bekommen eine
eigene Auswahl „Standard / Brand“ (nur bei Multi-Brand): Import, Export,
Einrichtungs-Snippet, „Sprachen verwalten“. **[Annahme]**

### Rest der Oberfläche

Entfernt: Seite und Menüpunkt „Environments“, ihre Route, das
Environment-Feld beim Anlegen von API-Keys, die Environment-Auswahl bei
Webhooks, Environment-Filter und -Spalten in Audit-Log und Overview, alle
zugehörigen UI-Texte in allen UI-Sprachen. Der leere Zustand „keine
Environments“ auf der Übersetzungs-Seite entfällt.

## 8. Doku

README, `CLAUDE.md` (Projektbeschreibung nennt Environments), API-Key-Hinweise
und `docs/COOLIFY.md` werden angepasst, soweit sie Environments nennen.

## 9. Vorhandene Daten

Es ist keine Instanz in Benutzung: keine Datenbank mit Texten, die erhalten
bleiben müssen, keine App am bisherigen Auslieferungs-Pfad. **[Nutzer]** Es
gibt deshalb kein Umstellungs-Skript, keine Weiterleitung des alten Pfads und
keine Übergangslogik für Webhooks.

Folge für vorhandene Entwicklungs-Datenbanken: Das Backend führt bei jedem Start `prisma db push` aus und
startet nicht, wenn das scheitert. Der eindeutige Index der Texte ändert sich
von (Key, Environment, Sprache, Scope) auf (Key, Sprache, Scope). Hat ein Key
in einer vorhandenen Datenbank Texte in zwei Environments, schlägt das
Anlegen des Index fehl und das neue Image startet nicht (aus Dockerfile und
Schema gelesen, nicht ausprobiert).

Jede vorhandene Datenbank (lokal, Coolify) muss deshalb vor dem Start der
neuen Version von Hand geleert werden; das steht in README und
`docs/COOLIFY.md`. Der Code leert nichts automatisch.

## 10. Dem Builder überlassen

- Prisma-Schema und Indizes, Routen und DTOs
- Form des Brand-Anteils in der Tabellen-Antwort
- Aufteilung der Tabellen-Komponenten und des Hooks `useTranslations`
- Reihenfolge der Arbeit; naheliegend: Backend ohne Environments, dann
  Link/Unlink, dann Oberfläche

## 11. Erfolgskriterien

- `backend` und `frontend`: Build, Tests und `npm run biome:check` grün; die
  Suche nach `environment` findet in `backend/src`, `frontend/src` und im
  Prisma-Schema nur noch Treffer ohne Bezug zum entfernten Konzept (z. B.
  `process.env`, „Umgebungsvariable“).
- Eine App mit `loadPath` `/sdk/translations/<projekt>/{{lng}}/{{ns}}` zeigt
  die Texte an; mit `?brandKey=` die der Brand.
- In einem Multi-Brand-Projekt: Zeile aufklappen, Text einer Brand ändern →
  die Auslieferung für diese Brand liefert den neuen Text, für andere Brands
  und ohne Brand den Standardtext.
- „Wieder verknüpfen“ → die Brand liefert wieder den Standardtext, auch nach
  einer späteren Änderung des Standardtexts.
- Ein Single-Brand-Projekt zeigt keinen Pfeil und keine Brand-Elemente.
