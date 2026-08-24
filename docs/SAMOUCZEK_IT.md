# Patron: guida per l'Avvocato

**Passo dopo passo, dal primo avvio all'atto pronto.**
Corrisponde all'installatore di giugno 2026. Non serve alcuna preparazione tecnica. Se sa lavorare con i documenti in Word, sa usare Patron.

---

## Indice

1. [Che cos'è Patron (in un paragrafo)](#1-che-cosè-patron)
2. [Primo avvio](#2-primo-avvio)
3. [Mappa dello schermo: tre pannelli](#3-mappa-dello-schermo)
4. [Passo 1: creare il fascicolo e caricare i file](#4-passo-1-creare-il-fascicolo-e-caricare-i-file)
5. [Passo 2: la chat con gli atti del fascicolo](#5-passo-2-la-chat-con-gli-atti-del-fascicolo)
6. [Passo 3: giurisprudenza e legislazione](#6-passo-3-giurisprudenza-e-legislazione)
7. [Passo 4: lavorare sui documenti e MODIFICARLI](#7-passo-4-modificare-i-documenti)
8. [Passo 5: una tabella da una serie di contratti (Revisione tabellare)](#8-passo-5-una-tabella-dai-contratti)
9. [Passo 6: i workflow (attività ripetibili)](#9-passo-6-i-workflow)
10. [Passo 7: scegliere il modello AI](#10-passo-7-scegliere-il-modello)
11. [Libreria delle competenze](#11-libreria-delle-competenze)
12. [Domande frequenti e problemi](#12-faq)
13. [Promemoria: prompt pronti](#13-promemoria-prompt-pronti)

---

## 1. Che cos'è Patron

Patron è il Suo assistente legale installato **sul Suo computer** (un'applicazione desktop, come Word). Lei carica gli atti del fascicolo (contratti, atti di citazione, sentenze, scansioni) e Patron:

- **li legge per Lei** e risponde alle Sue domande, citando le fonti dai Suoi stessi documenti,
- **ricerca la giurisprudenza** e **la legislazione** (diritto italiano e diritto UE) in un set completo di banche dati integrate,
- **propone modifiche ai documenti** sotto forma di revisioni (le track changes di Word), che Lei accetta con un clic,
- **perfeziona i Suoi atti** (revisione, avvocato del diavolo, editing linguistico).

Patron non prende decisioni legali e non sostituisce il Suo giudizio. È uno strumento: una lettura più rapida del fascicolo e una prima bozza che Lei verifica in ogni caso.

---

## 2. Primo avvio

1. Avvii **PATRON** (l'icona sul desktop o il menu Start). Vedrà una schermata di caricamento e, dopo una decina di secondi, la finestra principale. Non serve alcun account né login. Patron è single-user e locale, quindi gli atti del fascicolo, le banche dati e la cronologia delle chat restano sul Suo computer.
2. **Aggiunga la chiave di un modello AI.** È l'unico passo senza il quale l'assistente non risponde. Apra **Account → Modelli e chiavi API** e incolli la chiave del Suo provider (per esempio Libra/Anthropic, oppure Gemini/OpenAI). Salvi. Da quel momento la chat, la modifica dei documenti e le tabelle funzionano. Dettagli: [Passo 7](#10-passo-7-scegliere-il-modello).
3. **Internet e conversione dei file.** Un modello cloud e la ricerca dal vivo di giurisprudenza e legislazione (Normattiva, Corte Costituzionale) richiedono una connessione internet. La ricerca nei Suoi documenti funziona anche offline. Se al caricamento di vecchi file `.doc` compare un errore di conversione, chieda al Suo amministratore di installare LibreOffice (è gratuito).

> **Suggerimento:** Patron si rivolge a Lei con "Avvocato". Le parla in italiano e redige gli atti in italiano, perché sono destinati ai tribunali italiani. Non sa da dove cominciare? Glielo chieda direttamente in chat: **"Cosa sai fare?"** oppure **"Da dove comincio?"**, e Le presenterà le sue funzioni passo dopo passo. Se non vede qualcosa, espanda il pannello di sinistra (**Esploratore**).

---

## 3. Mappa dello schermo

Lo schermo dell'assistente è diviso in **tre pannelli verticali**:

| Pannello | Nome | A cosa serve |
|---|---|---|
| **sinistro** | **Esploratore** | l'elenco dei fascicoli (progetti) e dei documenti; è qui che carica i file |
| **centrale** | **Anteprima del documento** | il contenuto del documento su cui ha cliccato; è qui che compaiono le revisioni |
| **destro** | **Assistente** | la chat, dove pone domande e impartisce istruzioni |

Può comprimere il pannello di sinistra ("Comprimi l'esploratore") ed espanderlo di nuovo quando Le serve spazio per l'anteprima.

---

## 4. Passo 1: creare il fascicolo e caricare i file

**Regola 1: un fascicolo = un progetto.** Non mescoli file di cause diverse. Per ogni domanda che pone, Patron cerca in tutti i documenti del progetto.

### 4.1. Creare un progetto
1. Nel pannello di sinistra, clicchi **Nuovo progetto** (o "Nuovo fascicolo", scorciatoia **Ctrl+N**).
2. Gli dia un nome parlante, per esempio `Rossi c. Bianchi Costruzioni, causa 2026`, e compili il **Rif. fascicolo** - compare poi come colonna propria nell'elenco dei casi.

### 4.2. Caricare i documenti: tre modi

- **Trascina e rilascia:** selezioni i file o la cartella in Esplora file di Windows e li rilasci sul pannello (vedrà "Rilascia per caricare").
- **Carica documenti:** il pulsante nel pannello di sinistra, poi scelga i file (PDF, DOCX, DOC).
- **Importa la cartella del fascicolo** (l'opzione più rapida con molti file): indichi il percorso della cartella, per esempio `C:\Fascicoli\Rossi-2026`. Patron importerà tutti i file in una volta, li scansionerà per la sicurezza e li indicizzerà.

Cosa succede dietro le quinte (Lei non deve fare nulla): Patron riconosce la struttura redazionale del documento (articoli, commi, punti), esegue l'OCR sulle scansioni e il testo completo entra nella ricerca. Funzionano anche le scansioni cartacee e i file senza livello di testo.

> **Regola 2: carichi TUTTI gli atti del fascicolo prima della prima domanda.** Più completo è il fascicolo, più precise sono le risposte. I documenti aggiunti dopo non cambieranno retroattivamente le risposte precedenti.

---

## 5. Passo 2: la chat con gli atti del fascicolo

Nel pannello di destra (**Assistente**), scriva la Sua domanda e la invii. Patron seleziona da solo i passaggi più rilevanti dell'intero fascicolo (non deve incollare alcun testo).

**Ponga domande specifiche.** Invece di "cosa c'è nel contratto", scriva:
- "Quali obblighi ha il committente ai sensi dell'art. 5 del contratto n. 3?"
- "Elenca tutti i termini di pagamento e le penali contrattuali di questo contratto."
- "Ci sono i presupposti per un'eccezione di prescrizione? Indica le date nel fascicolo."
- "Quali incongruenze ci sono tra il contratto principale e l'allegato n. 2?"

### Legga il badge colorato accanto alle citazioni
Ogni citazione tratta dai Suoi documenti riceve un indicatore di affidabilità:

- 🟢 **verde:** citazione letterale, trovata negli atti del Suo fascicolo. Può usarla in un atto indicando la fonte.
- 🟡 **giallo:** possibile rielaborazione o parafrasi. La confronti con l'originale.
- 🔴 **rosso:** non trovata nel fascicolo. **Non la citi senza una verifica manuale.** Potrebbe essere una formulazione che soltanto suona come una citazione.

> **Regola 3: prima di incollare una citazione in un atto, guardi il badge.** È il Suo filtro anti-allucinazioni.

---

## 6. Passo 3: giurisprudenza e legislazione

L'edizione italiana di Patron arriva con **il connettore del diritto italiano integrato** (funziona subito dopo l'installazione, senza configurazione):

| Banca dati | Cosa vi trova |
|---|---|
| **Normattiva** | la legislazione italiana: Gazzetta Ufficiale, testi normativi nella versione vigente |
| **Corte Costituzionale** | la giurisprudenza della Corte Costituzionale |

Gli altri connettori NON sono inclusi nell'installatore - l'edizione resta leggera. Il diritto UE (**EUR-Lex**, il corpus di conformità **EU-Compliance** offline: GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) e i connettori di altre giurisdizioni (compresi quelli polacchi: SAOS, NSA, ISAP, KRS) si scaricano separatamente dalla **MateMatic Boutique** (matematicsolutions.com/boutique) e si collegano all'applicazione. Una volta installati, li attiva nelle impostazioni: **Account → Connettori** ("Connettori del diritto").

Chieda in linguaggio naturale e Patron sceglierà da solo la banca dati giusta:

- "Trova le sentenze della Corte Costituzionale in materia di risarcimento del danno non patrimoniale. Indica gli estremi delle pronunce."
- "Mostrami l'articolo 2043 del codice civile."
- Con il connettore EU-Compliance installato dalla Boutique: "Qual è la definizione di sistema di AI ad alto rischio nell'AI Act?"
- Con i connettori polacchi installati dalla Boutique: "Verifica il consiglio di amministrazione di Nowak-Bud sp. z o.o. nel KRS." Le ricerche di giurisprudenza polacca restituiscono sentenze reali dalla banca dati SAOS, per esempio **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, con date e link.

> **Ricordi:** le banche dati sono un accesso rapido e uno spunto. Prima di citare una disposizione in un atto, ne verifichi il testo vigente nella fonte ufficiale, perché la legislazione cambia.

---

## 7. Passo 4: modificare i documenti

Questo è il cuore del lavoro quotidiano. Patron modifica i documenti in tre modi. Tutti si concludono con un file che Lei apre in Word.

### 7A. Chiedere una modifica, esaminare le revisioni, accettare

È la modalità più comoda per le correzioni puntuali in un contratto o in un atto.

1. Nell'Esploratore, **clicchi un documento DOCX**. Compare nel pannello centrale (**Anteprima del documento**).
2. Nell'Assistente, scriva cosa vuole, **indicando il punto**:
   - "Proponi una modifica all'art. 4. Voglio limitare la responsabilità dell'appaltatore al danno emergente, con esclusione del lucro cessante."
   - "Aggiungi all'art. 3 una clausola che indichi come foro competente quello della sede del committente."
   - "Riformula l'art. 7 in modo che il termine di preavviso sia di 3 mesi, con effetto dalla fine del mese."
3. Patron risponde con **schede di modifica**. Ogni scheda mostra:
   - il testo **aggiunto** in verde,
   - il testo **rimosso** in rosso, barrato,
   - una breve **motivazione** della modifica.
4. Ogni scheda Le offre tre pulsanti:
   - **Accetta:** Patron applica la modifica e crea una **nuova versione** del documento (vere revisioni di Word),
   - **Rifiuta:** la modifica scompare,
   - **Apri:** anteprima della modifica nel contesto dell'intero documento.
5. Una volta accettato, scarichi il file finito (l'icona di download accanto al documento) e lo apra in Word. Vedrà le modifiche come una revisione in attesa dell'accettazione finale.

> Può accettare le modifiche una per una o in blocco. Ogni accettazione salva una nuova versione e le versioni precedenti restano nella cronologia, quindi non perde nulla.

### 7B. Perfezionare un intero atto: "Bozza di risposta" (revisione, avvocato del diavolo, linguaggio)

È la modalità per un intero atto, o per un passaggio più lungo che vuole rafforzare.

1. Apra il pannello **Bozza di risposta** (l'icona ✨ sotto la risposta dell'assistente, oppure dal menu).
2. Nel campo **Testo dell'atto**, incolli il Suo testo di lavoro.
3. Scelga la prospettiva per l'avvocato del diavolo (**"da quale prospettiva"**):
   - **Controparte:** come lo attaccherà il difensore dell'altra parte,
   - **Il tribunale:** su cosa farà domande il collegio,
   - **Pubblico ministero:** l'angolo dell'accusa.
4. Clicchi **Perfeziona l'atto**. Patron fa passare il testo per tre fasi:
   - **Revisore:** segnala le lacune logiche e i riferimenti deboli, e rafforza l'argomentazione,
   - **Avvocato del diavolo:** anticipa e confuta le controargomentazioni dalla prospettiva scelta,
   - **Scrivi in modo chiaro:** rimuove lo "stile AI" mantenendo la precisione giuridica.
5. Ottiene una **Bozza pronta** (che può copiare) e una sezione espandibile **"Come è nata la bozza"** che mostra cosa ha cambiato ciascuna fase.

> **Regola 4: la pipeline rende al meglio su un testo finito, non su un prompt vuoto.** Scriva la Sua versione, la incolli e chieda di rafforzarla. Poi aggiunga la Sua revisione e, se serve, un secondo passaggio.

### 7C. Andata e ritorno: modificare in Word, tornare in Patron

Se preferisce lavorare in Word:

1. Scarichi il documento da Patron.
2. In Word, apporti **le Sue modifiche con le revisioni attive**, aggiunga commenti e, ovunque voglia che Patron faccia qualcosa, scriva un'istruzione in un commento nel formato `[PATRON: scriva qui l'istruzione]`.
3. Carichi di nuovo il file (come nuova versione). Patron legge le Sue revisioni, i commenti e le istruzioni `[PATRON: ...]`, e impara il Suo stile di editing.

### 7D. Versioni e download
- Ogni modifica accettata = una nuova versione (la cronologia viene conservata).
- Scarichi un singolo file con l'icona di download, oppure l'intero progetto come ZIP.

---

## 8. Passo 5: una tabella dai contratti

Quando ha **molti documenti simili** (per esempio 30 contratti di locazione) e vuole confrontarli in una tabella, usi la **Revisione tabellare**.

1. Vada in **Revisioni tabellari → + Crea nuova**.
2. Aggiunga le colonne, dai preset giuridici pronti (Parti, Oggetto, Penale contrattuale, Legge applicabile, Termine di preavviso…) oppure Sue, per esempio "Clausola GDPR: sì/no".
3. Clicchi **Genera**. La tabella si riempie in streaming: Patron cerca in ogni documento e inserisce il risultato.
4. Ogni cella ha un badge di affidabilità (🟢/🟡/🔴). 🔴 significa verifica manuale; clicchi la cella per vedere la fonte.
5. Esporti in Excel per il cliente o per il team.

> Il punto: esamina una serie di contratti in un solo passaggio invece di aprirli uno per uno, e ogni cella rimanda alla sua fonte.

---

## 9. Passo 6: i workflow

Salvi una volta un'attività ripetibile (per esempio "Analisi di locazioni", "Revisione due diligence") come **workflow** e la esegua sui nuovi fascicoli con un solo clic.

- Cominci dai workflow integrati.
- I Suoi: **Workflow → Aggiungi workflow**, scriva le istruzioni passo per passo e salvi.
- Può condividere un workflow con i colleghi, così l'intero studio conduce la due diligence sulla stessa checklist.

---

## 10. Passo 7: scegliere il modello

Patron è **neutrale rispetto ai fornitori**, quindi il modello lo sceglie Lei. Sono **due** impostazioni in **Account → Modelli e chiavi API**: il modello della conversazione e un **Modello per le revisioni tabellari** separato. Alle tabelle si assegna di solito un modello più economico - il lavoro è molto e ogni campo è breve. Cambiarle non richiede alcuna reinstallazione.

- **Un modello cloud (per esempio Libra / Claude, Gemini)** offre la migliore qualità di redazione e di ragionamento. È la scelta ordinaria di lavoro per uno studio. Il contenuto della Sua richiesta va allora al provider che ha scelto.
- **Un modello locale (Ollama)** funziona senza internet, a costo zero. Richiede un'installazione una tantum di Ollama e il download del modello sul Suo computer.

Può combinarli: un modello più economico o locale per esplorare il fascicolo, uno più forte per l'atto finale. Consumo e costi si controllano in **Account → Consumo** (con filtro per fascicolo).

**Pratiche coperte dal segreto professionale e il cloud.** Nella versione desktop Lei, avvocato sulla Sua macchina, è l'host dei dati, quindi la Sua scelta di un modello cloud è un consenso informato. Patron Le permette di lavorare con qualsiasi modello, anche sulle pratiche contrassegnate come riservate. **Ogni** flusso di dati verso il modello viene registrato in un registro di audit immutabile (prova di diligenza, AI Act art. 12), e i dati personali vengono mascherati prima dell'invio. Se lo studio vuole un regime più rigoroso (per esempio pratiche riservate solo su modello locale), l'amministratore può impostarlo. Per impostazione predefinita nulla La blocca.

---

## 11. Libreria delle competenze

La **Libreria delle competenze** è un insieme di "competenze" che Patron applica quando perfeziona gli atti:

- **Integrate** (sempre attive): **Revisore**, **Avvocato del diavolo**, **Scrivi in modo chiaro**.
- **Installate** (le Sue): può attivare, disattivare e importare fasi aggiuntive da un file.

Quelle integrate non richiedono alcuna configurazione. Lavorano nel pannello "Bozza di risposta".

---

## 12. FAQ

**L'assistente non risponde, o la chat restituisce un errore (specie subito dopo l'installazione).**
La causa più comune è la mancanza della chiave del modello. Apra **Account → Modelli e chiavi API** e aggiunga una chiave (per esempio Libra/Anthropic). La seconda causa è la mancanza di internet con un modello cloud. Verifichi anche in **Account → Modelli e chiavi API** che il modello selezionato sia uno di cui possiede la chiave.

**I miei atti del fascicolo finiscono nel cloud?**
Solo se ha scelto un modello cloud; in quel caso il contenuto della Sua richiesta va a quel provider. Con un modello locale, tutto resta sul Suo computer. I file, le banche dati e la cronologia delle chat sono sempre archiviati in locale.

**Patron ha scritto qualcosa che non è nel fascicolo.**
Guardi il badge: 🔴 significa non verificato. I modelli possono "riempire i vuoti". Il badge e la Sua verifica personale sono il filtro finale, e Patron non lo sostituisce.

**La conversione DOCX/PDF non funziona.**
La conversione dei documenti richiede LibreOffice sul computer. Se manca qualcosa, lo segnali all'amministratore dello studio.

**Come esporto in Word un atto con i commenti?**
Chieda le modifiche come revisioni (Passo 4A), accetti quelle che vuole e scarichi il DOCX. In Word vedrà una revisione in attesa dell'accettazione finale.

**Patron verifica se una norma è vigente?**
Le banche dati offrono un accesso rapido al testo, ma possono essere in ritardo rispetto alla Gazzetta Ufficiale. Verifichi il testo vigente nella fonte ufficiale prima di redigere.

**Patron prende decisioni legali?**
No. La valutazione giuridica, la firma e la responsabilità professionale sono Sue.

---

## 13. Promemoria: prompt pronti

**Chat con gli atti del fascicolo**
- "Elenca tutti i termini e le penali contrattuali di questo contratto."
- "Quali incongruenze ci sono tra il documento A e il documento B?"
- "C'è un problema di prescrizione? Indica le date nel fascicolo."

**Giurisprudenza e legislazione**
- "Trova le sentenze della Corte Costituzionale in materia di [tema]. Indica gli estremi delle pronunce."
- "Mostra l'articolo [X] del [codice]."
- Con i connettori polacchi attivati: "Verifica [nome della società] nel KRS."

**Modificare un documento (dopo aver cliccato un file DOCX)**
- "Proponi una modifica all'art. [X]: [cosa vuole], come revisioni."
- "Aggiungi all'art. [X] una clausola [descrizione]."
- "Riformula l'art. [X]: [nuovo testo o obiettivo]."

**Perfezionare un atto**
- Il pannello "Bozza di risposta": incolli il testo, scelga la prospettiva, poi "Perfeziona l'atto".

---

*Patron è uno strumento a supporto del lavoro dell'avvocato. Ogni atto viene verificato e firmato dall'Avvocato prima dell'invio. Questo documento riflette lo stato dell'applicazione a giugno 2026.*
