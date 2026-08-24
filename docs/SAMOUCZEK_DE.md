# Patron: eine Anleitung für die Rechtsanwältin und den Rechtsanwalt

**Schritt für Schritt, vom ersten Start bis zum fertigen Schriftsatz.**
Entspricht dem Installer von Juni 2026. Sie benötigen keinerlei technische Vorkenntnisse. Wenn Sie mit Dokumenten in Word arbeiten können, können Sie Patron bedienen.

---

## Inhaltsverzeichnis

1. [Was Patron ist (in einem Absatz)](#1-was-patron-ist)
2. [Erster Start](#2-erster-start)
3. [Bildschirmaufteilung: drei Panels](#3-bildschirmaufteilung)
4. [Schritt 1: Eine Akte anlegen und die Dateien hochladen](#4-schritt-1-eine-akte-anlegen-und-die-dateien-hochladen)
5. [Schritt 2: Chat mit den Aktenunterlagen](#5-schritt-2-chat-mit-den-aktenunterlagen)
6. [Schritt 3: Rechtsprechung und Gesetzgebung durchsuchen](#6-schritt-3-rechtsprechung-und-gesetzgebung)
7. [Schritt 4: Mit Dokumenten arbeiten und sie BEARBEITEN](#7-schritt-4-dokumente-bearbeiten)
8. [Schritt 5: Eine Tabelle aus einer Reihe von Verträgen (Tabellarische Prüfung)](#8-schritt-5-eine-tabelle-aus-verträgen)
9. [Schritt 6: Workflows (wiederkehrende Aufgaben)](#9-schritt-6-workflows)
10. [Schritt 7: Ein KI-Modell wählen](#10-schritt-7-ein-modell-wählen)
11. [Skill-Bibliothek](#11-skill-bibliothek)
12. [Häufige Fragen und Probleme](#12-faq)
13. [Spickzettel: fertige Prompts](#13-spickzettel-fertige-prompts)

---

## 1. Was Patron ist

Patron ist Ihr juristischer Assistent, installiert **auf Ihrem eigenen Rechner** (eine Desktop-Anwendung, wie Word). Sie laden die Aktenunterlagen hoch (Verträge, Klageschriften, Urteile, Scans) und Patron:

- **liest sie für Sie** und beantwortet Ihre Fragen, wobei die Quellen aus Ihren eigenen Dokumenten belegt werden,
- **durchsucht die Rechtsprechung** (Bundesgerichtshof, Instanzgerichte, Bundesverfassungsgericht) und die **Gesetzgebung** (deutsches Bundesrecht) über den mitgelieferten Konnektor,
- **schlägt Änderungen an Dokumenten** als nachverfolgte Änderungen vor (die Änderungsverfolgung von Word), die Sie mit einem Klick annehmen,
- **arbeitet Ihre Schriftsätze aus** (Review, Advocatus Diaboli, sprachliche Redaktion).

Patron trifft keine rechtlichen Entscheidungen und ersetzt nicht Ihr eigenes Urteil. Es ist ein Werkzeug: ein schnelleres Lesen der Akte und ein erster Entwurf, den Sie in jedem Fall selbst prüfen.

---

## 2. Erster Start

1. Starten Sie **PATRON** (das Symbol auf dem Desktop oder das Startmenü). Sie sehen einen Ladebildschirm und nach etwa einem Dutzend Sekunden das Hauptfenster. Es ist kein Konto und keine Anmeldung nötig. Patron ist einbenutzerfähig und lokal, sodass die Aktenunterlagen, die Datenbanken und der Chatverlauf auf Ihrem Rechner bleiben.
2. **Fügen Sie einen Schlüssel für ein KI-Modell hinzu.** Das ist der eine Schritt, ohne den der Assistent nicht antwortet. Öffnen Sie **Konto → Modelle und API-Schlüssel** und fügen Sie den Schlüssel Ihres Anbieters ein (zum Beispiel Anthropic/Claude oder Google/Gemini, OpenAI). Speichern Sie ihn. Ab diesem Moment funktionieren Chat, Dokumentbearbeitung und Tabellen. Einzelheiten: [Schritt 7](#10-schritt-7-ein-modell-wählen).
3. **Internet und Dateikonvertierung.** Ein Cloud-Modell und die Live-Recherche in der Rechtsprechung und der Gesetzgebung (NeuRIS) benötigen eine Internetverbindung. Die Suche in Ihren eigenen Dokumenten funktioniert auch offline. Wenn beim Hochladen älterer `.doc`-Dateien ein Konvertierungsfehler erscheint, bitten Sie Ihren Administrator, LibreOffice zu installieren (es ist kostenlos).

> **Tipp:** Patron spricht Sie mit "Frau Kollegin" bzw. "Herr Kollege" an. Es spricht mit Ihnen auf Deutsch und verfasst die Schriftsätze auf Deutsch, weil sie bei deutschen Gerichten eingereicht werden. Sie wissen nicht, wo Sie anfangen sollen? Fragen Sie es direkt im Chat: **"Was können Sie?"** oder **"Wie fange ich an?"**, und es stellt Ihnen seine Funktionen Schritt für Schritt vor. Wenn Sie etwas nicht sehen, klappen Sie das linke Panel aus (**Explorer**).

---

## 3. Bildschirmaufteilung

Der Bildschirm des Assistenten ist in **drei senkrechte Panels** geteilt:

| Panel | Name | Wofür es dient |
|---|---|---|
| **links** | **Explorer** | die Liste der Akten (Projekte) und Dokumente; hier laden Sie Dateien hoch |
| **Mitte** | **Dokumentansicht** | der Inhalt des Dokuments, das Sie angeklickt haben; hier erscheinen die nachverfolgten Änderungen |
| **rechts** | **Assistent** | der Chat, in dem Sie Fragen stellen und Anweisungen geben |

Sie können das linke Panel einklappen ("Explorer einklappen") und wieder ausklappen, wenn Sie Platz für die Ansicht brauchen.

---

## 4. Schritt 1: Eine Akte anlegen und die Dateien hochladen

**Regel 1: eine Akte = ein Projekt.** Vermischen Sie keine Dateien aus verschiedenen Sachen. Bei jeder Frage, die Sie stellen, durchsucht Patron alle Dokumente des Projekts.

### 4.1. Ein Projekt anlegen
1. Klicken Sie im linken Panel auf **Neues Projekt** (oder "Neue Akte", Tastenkürzel **Strg+N**).
2. Geben Sie ihm einen sprechenden Namen, z. B. `Mueller ./. Bauer GmbH, Klage 2026`, und tragen Sie das **Az.** ein - es erscheint spaeter als eigene Spalte in der Fallliste.

### 4.2. Dokumente hochladen: drei Wege

- **Ziehen und ablegen:** Markieren Sie die Dateien oder den Ordner im Windows-Explorer und legen Sie sie auf dem Panel ab (Sie sehen "Zum Hochladen ablegen").
- **Dokumente hochladen:** die Schaltfläche im linken Panel, dann wählen Sie die Dateien (PDF, DOCX, DOC).
- **Aktenordner importieren** (die schnellste Option bei vielen Dateien): Geben Sie den Pfad zum Verzeichnis an, z. B. `C:\Akten\Mueller-2026`. Patron zieht alle Dateien auf einmal herein, prüft sie auf Sicherheit und indexiert sie.

Was hinter den Kulissen passiert (Sie müssen nichts tun): Patron erkennt die redaktionelle Struktur des Dokuments (Paragraphen, Absätze, Nummern), führt OCR auf Scans aus und der vollständige Text geht in die Suche ein. Auch Papierscans und Dateien ohne Textebene funktionieren.

> **Regel 2: laden Sie ALLE Aktenunterlagen vor Ihrer ersten Frage hoch.** Je vollständiger die Akte, desto genauer die Antworten. Später hinzugefügte Dokumente ändern frühere Antworten nicht rückwirkend.

---

## 5. Schritt 2: Chat mit den Aktenunterlagen

Tippen Sie im rechten Panel (**Assistent**) Ihre Frage ein und senden Sie sie ab. Patron wählt die relevantesten Passagen aus der gesamten Akte selbst aus (Sie müssen keinen Text einfügen).

**Stellen Sie konkrete Fragen.** Statt "was steht im Vertrag" schreiben Sie:
- "Welche Pflichten treffen den Auftraggeber nach § 5 des Vertrags Nr. 3?"
- "Listen Sie jede Zahlungsfrist und Vertragsstrafe in diesem Vertrag auf."
- "Bestehen Gründe für die Einrede der Verjährung? Verweisen Sie auf die Daten in der Akte."
- "Welche Widersprüche bestehen zwischen dem Hauptvertrag und der Anlage Nr. 2?"

### Lesen Sie das farbige Kennzeichen neben den Zitaten
Jedes Zitat aus Ihren Dokumenten erhält einen Zuverlässigkeitsmarker:

- 🟢 **grün:** ein wörtliches Zitat, in Ihren Aktenunterlagen gefunden. Sie können es unter Angabe der Quelle in einem Schriftsatz verwenden.
- 🟡 **gelb:** eine mögliche Umformulierung oder Paraphrase. Gleichen Sie es mit dem Original ab.
- 🔴 **rot:** in der Akte nicht gefunden. **Zitieren Sie es nicht ohne manuelle Prüfung.** Es kann eine Formulierung sein, die nur wie ein Zitat klingt.

> **Regel 3: bevor Sie ein Zitat in einen Schriftsatz einfügen, sehen Sie sich das Kennzeichen an.** Es ist Ihr Filter gegen Halluzinationen.

---

## 6. Schritt 3: Rechtsprechung und Gesetzgebung

Die deutsche Ausgabe von Patron kommt mit **dem integrierten Konnektor für deutsches Recht** (er funktioniert sofort nach der Installation, ohne Konfiguration):

| Datenbank | Was Sie darin finden |
|---|---|
| **NeuRIS** | deutsches Bundesrecht: Gesetze und Verordnungen in der geltenden Fassung sowie Bundesrechtsprechung, mit ELI-Kennungen (rechtsinformationen.bund.de) |

Die übrigen Konnektoren sind NICHT im Installer enthalten - die Ausgabe bleibt schlank. Das EU-Recht (**EUR-Lex**, das Offline-Compliance-Korpus **EU-Compliance**: DSGVO, AI Act, DORA, NIS2, eIDAS 2.0, CRA) sowie die Konnektoren anderer Jurisdiktionen (darunter die polnischen: SAOS, NSA, ISAP, KRS) werden separat aus der **MateMatic Boutique** (matematicsolutions.com/boutique) heruntergeladen und an die Anwendung angehängt. Nach der Installation aktivieren Sie sie in den Einstellungen: **Konto → Konnektoren** ("Rechtsquellen-Konnektoren").

Fragen Sie in natürlicher Sprache, und Patron greift selbst zur richtigen Datenbank:

- "Zeigen Sie mir § 823 BGB."
- "Finden Sie Entscheidungen des Bundesgerichtshofs zum Ersatz des immateriellen Schadens. Geben Sie die Aktenzeichen an."
- Mit dem aus der Boutique installierten Konnektor EU-Compliance: "Wie lautet die Definition eines Hochrisiko-KI-Systems im AI Act?"
- Mit den aus der Boutique installierten polnischen Konnektoren: "Prüfen Sie den Vorstand der Nowak-Bud sp. z o.o. im KRS." Recherchen in der polnischen Rechtsprechung liefern echte Entscheidungen aus der Datenbank SAOS, zum Beispiel **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, mit Datum und Link.

> **Denken Sie daran:** die Datenbanken sind ein schneller Zugang und ein Anhaltspunkt. Bevor Sie eine Vorschrift in einem Schriftsatz zitieren, prüfen Sie ihren geltenden Wortlaut in der amtlichen Quelle, denn die Gesetzgebung ändert sich.

---

## 7. Schritt 4: Dokumente bearbeiten

Dies ist das Herzstück der täglichen Arbeit. Patron bearbeitet Dokumente auf drei Weisen. Alle enden mit einer Datei, die Sie in Word öffnen.

### 7A. Eine Änderung anfordern, die nachverfolgten Änderungen prüfen, annehmen

Das ist der bequemste Modus für einzelne Korrekturen in einem Vertrag oder Schriftsatz.

1. **Klicken Sie im Explorer auf ein DOCX-Dokument.** Es erscheint im mittleren Panel (**Dokumentansicht**).
2. Schreiben Sie im Assistenten, was Sie möchten, und **benennen Sie die Stelle**:
   - "Schlagen Sie eine Änderung zu § 4 vor. Ich möchte die Haftung des Auftragnehmers auf den unmittelbaren Schaden beschränken, unter Ausschluss des entgangenen Gewinns."
   - "Fügen Sie zu § 3 eine Klausel hinzu, die den Gerichtsstand am Sitz des Auftraggebers bestimmt."
   - "Formulieren Sie § 7 so um, dass die Kündigungsfrist 3 Monate beträgt, wirksam zum Monatsende."
3. Patron antwortet mit **Änderungskarten**. Jede Karte zeigt:
   - **hinzugefügten** Text in Grün,
   - **entfernten** Text in Rot mit Durchstreichung,
   - eine kurze **Begründung** der Änderung.
4. Jede Karte bietet Ihnen drei Schaltflächen:
   - **Annehmen:** Patron wendet die Änderung an und erstellt eine **neue Version** des Dokuments (echte nachverfolgte Änderungen von Word),
   - **Ablehnen:** die Änderung verschwindet,
   - **Öffnen:** Vorschau der Änderung im Kontext des gesamten Dokuments.
5. Sobald Sie angenommen haben, laden Sie die fertige Datei herunter (das Download-Symbol neben dem Dokument) und öffnen Sie sie in Word. Sie sehen die Änderungen als eine Überarbeitung, die auf die endgültige Annahme wartet.

> Sie können die Änderungen einzeln oder gesammelt annehmen ("Alle annehmen" / "Alle ablehnen"). Jede Annahme speichert eine neue Version, und die alten Versionen bleiben im Verlauf, sodass Sie nichts verlieren.

### 7B. Einen ganzen Schriftsatz ausarbeiten: "Entwurf der Erwiderung" (Review, Advocatus Diaboli, Sprache)

Das ist der Modus für einen ganzen Schriftsatz oder eine längere Passage, die Sie stärken wollen.

1. Öffnen Sie das Panel **Entwurf der Erwiderung** (das Symbol ✨ unter der Antwort des Assistenten oder aus dem Menü).
2. Fügen Sie im Feld **Text des Schriftsatzes** Ihren Arbeitstext ein.
3. Wählen Sie die Perspektive für den Advocatus Diaboli (**"aus wessen Perspektive"**):
   - **Gegenseite:** wie der Anwalt der anderen Partei ihn angreifen wird,
   - **Der Spruchkörper:** wonach die Richterbank fragen wird,
   - **Staatsanwalt:** der Blickwinkel der Anklage.
4. Klicken Sie auf **Schriftsatz ausarbeiten**. Patron führt den Text durch drei Stufen:
   - **Reviewer:** markiert Lücken in der Logik und schwache Fundstellen und stärkt die Argumentation,
   - **Advocatus Diaboli:** nimmt Gegenargumente aus der gewählten Perspektive vorweg und widerlegt sie,
   - **Verständlich schreiben:** entfernt den "KI-Stil" und bewahrt zugleich die juristische Präzision.
5. Sie erhalten einen **Fertigen Entwurf** (den Sie kopieren können) und einen aufklappbaren Abschnitt **"Wie der Entwurf entstanden ist"**, der zeigt, was jede Stufe geändert hat.

> **Regel 4: die Pipeline entfaltet ihre Wirkung am besten an fertigem Text, nicht an einem leeren Prompt.** Schreiben Sie Ihre eigene Fassung, fügen Sie sie ein und bitten Sie darum, sie zu stärken. Ergänzen Sie dann Ihre eigene Bearbeitung und bei Bedarf einen zweiten Durchlauf.

### 7C. Hin und zurück: in Word bearbeiten, zu Patron zurückkehren

Wenn Sie lieber in Word arbeiten:

1. Laden Sie das Dokument aus Patron herunter.
2. Nehmen Sie in Word **Ihre eigenen Änderungen bei aktivierter Änderungsverfolgung** vor, fügen Sie Kommentare hinzu und schreiben Sie überall dort, wo Patron etwas tun soll, eine Anweisung in einem Kommentar im Format `[PATRON: hier die Anweisung schreiben]`.
3. Laden Sie die Datei erneut hoch (als neue Version). Patron liest Ihre nachverfolgten Änderungen, die Kommentare und die `[PATRON: ...]`-Anweisungen und lernt Ihren Bearbeitungsstil.

### 7D. Versionen und Downloads
- Jede angenommene Änderung = eine neue Version (der Verlauf wird bewahrt).
- Laden Sie eine einzelne Datei mit dem Download-Symbol herunter oder das gesamte Projekt als ZIP.

---

## 8. Schritt 5: Eine Tabelle aus Verträgen

Wenn Sie **viele ähnliche Dokumente** haben (z. B. 30 Mietverträge) und sie in einer Tabelle vergleichen wollen, nutzen Sie die **Tabellarische Prüfung**.

1. Gehen Sie zu **Tabellarische Prüfungen → + Neu erstellen**.
2. Fügen Sie Spalten hinzu, entweder aus den fertigen juristischen Vorlagen (Parteien, Gegenstand, Vertragsstrafe, Anwendbares Recht, Kündigungsfrist…) oder eigene, z. B. "DSGVO-Klausel: ja/nein".
3. Klicken Sie auf **Generieren**. Die Tabelle füllt sich im Streaming: Patron durchsucht jedes Dokument und trägt das Ergebnis ein.
4. Jede Zelle hat ein Zuverlässigkeitskennzeichen (🟢/🟡/🔴). 🔴 bedeutet manuelle Prüfung; klicken Sie auf die Zelle, um die Quelle zu sehen.
5. Exportieren Sie nach Excel für die Mandantschaft oder das Team.

> Der Kern: Sie prüfen eine Reihe von Verträgen in einem Durchgang, statt sie einzeln zu öffnen, und jede Zelle verweist zurück auf ihre Quelle.

---

## 9. Schritt 6: Workflows

Speichern Sie eine wiederkehrende Aufgabe (z. B. "Mietvertragsanalyse", "Due-Diligence-Prüfung") einmal als **Workflow** und führen Sie sie auf neuen Akten mit einem einzigen Klick aus.

- Beginnen Sie mit den integrierten Workflows.
- Ihre eigenen: **Workflows → Workflow hinzufügen**, tippen Sie die Anweisungen Schritt für Schritt ein und speichern Sie.
- Sie können einen Workflow mit Kolleginnen und Kollegen teilen, sodass die ganze Kanzlei die Due Diligence anhand derselben Checkliste durchführt.

---

## 10. Schritt 7: Ein Modell wählen

Patron ist **anbieterneutral**, also wählen Sie das Modell. Es sind **zwei** Einstellungen unter **Konto → Modelle und API-Schlüssel**: das Modell für das Gespräch und ein separates **Modell für tabellarische Prüfungen**. Tabellen bekommen meist ein günstigeres Modell - es ist viel Arbeit und jedes Feld ist kurz. Eine Änderung erfordert in beiden Fällen keine Neuinstallation.

- **Ein Cloud-Modell (z. B. Claude, Gemini)** bietet die stärkste Ausarbeitung und Argumentation. Das ist die gewöhnliche Arbeitswahl für eine Kanzlei. Der Inhalt Ihrer Anfrage geht dann an den Anbieter, den Sie gewählt haben.
- **Ein lokales Modell (Ollama)** funktioniert ohne Internet, zu Nullkosten. Es erfordert eine einmalige Installation von Ollama und das Herunterladen des Modells auf Ihren Rechner.

Sie können sie kombinieren: ein günstigeres oder lokales Modell, um die Akte zu erkunden, ein stärkeres für den endgültigen Schriftsatz. Nutzung und Kosten prüfen Sie unter **Konto → Nutzung** (mit einem Filter nach Akte).

**Mandate unter dem Berufsgeheimnis und die Cloud.** In der Desktop-Version sind Sie, die Anwältin bzw. der Anwalt an der eigenen Maschine, der Host der Daten, sodass Ihre Wahl eines Cloud-Modells eine informierte Einwilligung ist. Patron erlaubt Ihnen, mit jedem Modell zu arbeiten, auch bei Mandaten, die als vertraulich gekennzeichnet sind. **Jeder** Datenfluss zum Modell wird in einem unveränderlichen Audit-Protokoll erfasst (Nachweis der Sorgfalt, AI Act Art. 12), und personenbezogene Daten werden vor dem Senden maskiert. Wenn die Kanzlei ein strengeres Regime möchte (z. B. vertrauliche Mandate nur auf einem lokalen Modell), kann der Administrator das einstellen. Standardmäßig blockiert Sie nichts.

---

## 11. Skill-Bibliothek

Die **Skill-Bibliothek** ist eine Sammlung von "Skills", die Patron beim Ausarbeiten von Schriftsätzen anwendet:

- **Integriert** (immer aktiv): **Reviewer**, **Advocatus Diaboli**, **Verständlich schreiben**.
- **Installiert** (Ihre eigenen): Sie aktivieren, deaktivieren und importieren zusätzliche Stufen aus einer Datei.

Die integrierten benötigen keine Konfiguration. Sie arbeiten im Panel "Entwurf der Erwiderung".

---

## 12. FAQ

**Der Assistent antwortet nicht, oder der Chat gibt einen Fehler zurück (besonders direkt nach der Installation).**
Die häufigste Ursache ist ein fehlender Modell-Schlüssel. Öffnen Sie **Konto → Modelle und API-Schlüssel** und fügen Sie einen Schlüssel hinzu (z. B. Anthropic/Claude). Die zweite Ursache ist fehlendes Internet bei einem Cloud-Modell. Prüfen Sie auch unter **Konto → Modelle und API-Schlüssel**, dass das ausgewählte Modell eines ist, für das Sie einen Schlüssel besitzen.

**Verlassen meine Aktenunterlagen den Rechner in die Cloud?**
Nur wenn Sie ein Cloud-Modell gewählt haben; dann geht der Inhalt Ihrer Anfrage an diesen Anbieter. Bei einem lokalen Modell bleibt alles auf Ihrem Rechner. Die Dateien, die Datenbanken und der Chatverlauf werden stets lokal gespeichert.

**Patron hat etwas geschrieben, das nicht in der Akte steht.**
Prüfen Sie das Kennzeichen: 🔴 bedeutet nicht verifiziert. Modelle können "Lücken füllen". Das Kennzeichen und Ihre eigene Prüfung sind der letzte Filter, und Patron ersetzt ihn nicht.

**Die DOCX/PDF-Konvertierung funktioniert nicht.**
Das Konvertieren von Dokumenten benötigt LibreOffice auf dem Rechner. Wenn etwas fehlt, wenden Sie sich an den Administrator der Kanzlei.

**Wie exportiere ich einen Schriftsatz mit Kommentaren nach Word?**
Fordern Sie die Änderungen als nachverfolgte Änderungen an (Schritt 4A), nehmen Sie die gewünschten an und laden Sie das DOCX herunter. In Word sehen Sie eine Überarbeitung, die auf die endgültige Annahme wartet.

**Prüft Patron, ob ein Gesetz aktuell ist?**
Die Datenbanken bieten schnellen Zugang zum Text, können aber dem amtlichen Stand hinterherhinken. Prüfen Sie den geltenden Wortlaut in der amtlichen Quelle, bevor Sie entwerfen.

**Trifft Patron rechtliche Entscheidungen?**
Nein. Die rechtliche Bewertung, die Unterschrift und die berufliche Verantwortung liegen bei Ihnen.

---

## 13. Spickzettel: fertige Prompts

**Chat mit den Aktenunterlagen**
- "Listen Sie jede Frist und Vertragsstrafe in diesem Vertrag auf."
- "Welche Widersprüche bestehen zwischen Dokument A und Dokument B?"
- "Gibt es ein Verjährungsproblem? Verweisen Sie auf die Daten in der Akte."

**Rechtsprechung und Gesetzgebung**
- "Finden Sie Entscheidungen des Bundesgerichtshofs zu [Thema]. Geben Sie die Aktenzeichen an."
- "Zeigen Sie § [X] [Gesetz]."
- Mit den aus der Boutique installierten polnischen Konnektoren: "Prüfen Sie [Firmenname] im KRS."

**Ein Dokument bearbeiten (nach dem Anklicken einer DOCX-Datei)**
- "Schlagen Sie eine Änderung zu § [X] vor: [was Sie möchten], als nachverfolgte Änderungen."
- "Fügen Sie zu § [X] eine Klausel [Beschreibung] hinzu."
- "Formulieren Sie § [X] um: [neuer Text oder Ziel]."

**Einen Schriftsatz ausarbeiten**
- Das Panel "Entwurf der Erwiderung": fügen Sie den Text ein, wählen Sie die Perspektive, dann "Schriftsatz ausarbeiten".

---

*Patron ist ein Werkzeug zur Unterstützung der anwaltlichen Arbeit. Jeder Schriftsatz wird vor dem Versand von der Rechtsanwältin bzw. dem Rechtsanwalt geprüft und unterschrieben. Dieses Dokument gibt den Stand der Anwendung im Juni 2026 wieder.*
