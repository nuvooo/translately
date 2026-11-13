# Changelog

## Unreleased

- Keys sperren: ein gesperrter Key kann weder umbenannt noch geloescht werden (Texte und Beschreibung bleiben bearbeitbar)
  - Sperren/Entsperren im Zeilenmenue ab Rolle Admin; ein Schloss mit Hinweistext markiert gesperrte Keys
  - Gilt auch fuer die API (409, `code: key_locked`) und die MCP-Werkzeuge `update_key` und `delete_key`; entsperrt wird nur in der Weboberflaeche
  - Ein Namespace mit gesperrten Keys laesst sich nicht entfernen
  - Audit-Aktionen `translation.key_locked` und `translation.key_unlocked`
- Uebersetzungsseite: das Zeilenmenue sitzt in der feststehenden Key-Spalte links und bleibt beim Scrollen durch viele Sprachen erreichbar; die Toolbar-Aktionen (Sprachen verwalten, Import, KI-Uebersetzung, i18next-Konfiguration, Export) liegen in einem gemeinsamen Menue "Aktionen"
- MCP-Server fuer KI-Werkzeuge (`POST /api/mcp`), arbeitet an genau einem Projekt:
  - Neuer API-Key-Typ "MCP": gebunden an ein Projekt, Anlegen ab Rolle Member (andere Key-Typen weiterhin ab Admin); der Key wird nur einmal angezeigt, zusammen mit einem kopierbaren Konfigurationsbeispiel (`mcpServers`, `type: http`)
  - Member sehen und loeschen nur ihre eigenen MCP-Keys (auch nach Herabstufung zum Viewer); ein MCP-Key hat hoechstens die Rechte seines Erstellers und wird durch Loeschen widerrufen, beim Entfernen aus der Organisation werden die MCP-Keys des Mitglieds geloescht
  - Werkzeuge: `get_project`, `list_keys`, `get_key`, `create_key`, `update_key`, `set_translations`, `translate_missing`, `delete_key`, `add_language` (Details im README, Abschnitt "MCP")
  - `add_language` fuegt eine Sprache zum Projekt oder (mit `brandKey`) zu einer Brand hinzu, ab Rolle Admin; Entfernen von Sprachen bleibt der Weboberflaeche vorbehalten, weil dabei Texte geloescht werden
  - `translate_missing` braucht `ANTHROPIC_API_KEY`; ohne Key uebersetzt das Werkzeug selbst und speichert mit `set_translations`. Mit `apply: true` werden KI-Uebersetzungen ohne manuelle Pruefung gespeichert, vorhandene Texte werden nie ueberschrieben, Platzhalter-Abweichungen nie gespeichert; hoechstens 20 Aufrufe pro Minute je Benutzer
  - nginx leitet `/api/mcp` mit 150 s Lese-Timeout weiter
- KI-Uebersetzung fehlender Texte:
  - KI-Vorschlag im Zellen-Editor: der Vorschlag landet im Entwurf und wird erst mit Enter oder beim Verlassen des Feldes gespeichert
  - Dialog "Mit KI übersetzen" fuer fehlende Standardtexte eines Namespace: Vorschlaege je Zielsprache pruefen und auswaehlen, erst "Übernehmen" speichert
  - Ohne Bestaetigung wird nichts gespeichert, vorhandene Texte werden nie ueberschrieben
  - Platzhalter-Pruefung: weichen die Platzhalter vom Quelltext ab, wird der Vorschlag markiert (im Dialog abgewaehlt)
  - Aktiv nur mit `ANTHROPIC_API_KEY`, Modell ueber `AI_TRANSLATION_MODEL` (Standard `claude-haiku-5-5`). Ohne Key ist die Funktion aus und es wird nichts gesendet; bei Nutzung gehen Key-Namen, Beschreibungen und Quelltexte an Anthropic
  - Audit-Aktion `translation.ai_translated` fuer uebernommene KI-Uebersetzungen
- Environments (Development/Staging/Production) entfernt, ein Text liegt jetzt einmal pro Projekt als Key x Sprache x Scope (Standard oder Brand). Breaking:
  - Auslieferungs-URL ohne Environment: `/sdk/translations/:projectKey/{{lng}}/{{ns}}`, kein Redirect vom alten Pfad
  - API-Keys sind nicht mehr an ein Environment gebunden
  - Webhooks feuern bei jeder Textaenderung des Projekts, ohne Environment-Auswahl und ohne `environment` im Payload
  - Kopieren zwischen Environments entfaellt; Import/Export pro Sprache, Namespace und Ziel (Standard oder Brand)
  - Die Datenbank muss vor dem ersten Start von Hand geleert werden (siehe README, "Upgrading from a version with environments")
- Uebersetzungsseite kompakt: Tabelle ohne Environment-Tabs, Key-Zeilen klappen pro Brand auf; Brand-Texte lassen sich loesen (eigener Text) und wieder verknuepfen (erbt den Standard)
- Start als Kopie von Togglely `c0c6f20`
