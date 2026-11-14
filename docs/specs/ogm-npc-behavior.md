# Contratto comportamentale degli agenti PNG

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-behavior`
- Role: spec
- Parent: [Ticket 01](../tickets/open-game-master-evolution/01-npc-behavior.md)

## Type
Feature / decision spec — comportamento, non architettura implementata.

## Status
Requisiti confermati nel colloquio. Nessun codice applicativo implementato o testato.

## Goal and Scope
Rendere credibili sia i compagni del party sia gli altri PNG: agenti distinti con
scheda, personalità, strumenti e conoscenze proprie, senza onniscienza o passato
inventato per convenienza narrativa. La prima versione riguarda una nuova campagna
di prova; partita esistente e Kokoro restano intatti.

## Decision Provenance
Conferme esplicite dell'utente nella conversazione che ha prodotto questa spec:
- «I personaggi sarebbero ispirati a loro, ovviamente»: personaggi originali,
  ispirati a figure storiche o fantastiche; non importazione letterale.
- «Certo che voglio così, sì, sì. Ispirazione, punto di partenza»: personalità
  iniziale riconoscibile, capace di evolvere tramite le esperienze.
- «Si a tutti e tre»: passato coerente, rivelazioni motivate, credenze distinte
  dai fatti. Nello stesso messaggio chiede capacità mentali coerenti con la scheda,
  esemplificando che Intelligenza 3 non deve ragionare come Sherlock Holmes.
- «SI», in risposta alla prevalenza della scheda: adattare l'ispirazione senza
  aumentare automaticamente le statistiche.
- «Si a ttto», in risposta al gruppo di quattro scelte: conoscenze tramite eventi
  con fonte e momento; attività fuori scena; autonomia PNG con regole server;
  nuova campagna di prova senza importazione della partita esistente.
- «Si va bene», in risposta alla gestione dei fallimenti: segnalazione e possibilità
  di riprovare, nessuna risposta inventata al posto dell'agente, nessun effetto o
  ricordo derivato dal tentativo fallito; effetti già conclusi conservati e non ripetuti.
Questi sì approvano i rispettivi comportamenti, non spese, deploy o merge.

## Current Behavior and Evidence
Il [prompt corrente](../../src/lib/dm/prompt.ts) affida al narratore anche i compagni.
La [logica dei testimoni](../../src/lib/dm/witness-logic.ts) è permissiva e produce
cautele nel prompt, non un isolamento stretto. Esistono già personalità, schede,
relazioni, coscienza e regole server: non vanno ricreati senza necessità.
Vedere [ricognizione upstream](../research/ogm-upstream-npc-agents.md) e
[rassegna scientifica](../research/llm-game-agents-evidence.md).
Base dell'indagine: `ff8635a2bbc6baa7f06388b9aa86bfa2bbb0f16d`, non vincolo di versione.

L'utente riferisce sconosciuti che conoscono il nome del protagonista e un compagno
che introduce tardivamente una corrispondenza con la vittima di un'indagine.
Sono casi di accettazione richiesti; non sono stati riprodotti in questa attività.

## Behavioral Contract

### 1. Identità, ispirazione ed evoluzione
Il riferimento culturale è un punto di partenza per motivazioni, contraddizioni,
temperamento e voce. Nome, biografia, relazioni e conoscenze appartengono alla
campagna. Il riferimento non importa poteri, eventi o persone della sua opera.
Il PNG evolve coerentemente con le esperienze vissute, mantenendo continuità:
un tradimento può renderlo più diffidente, non sostituirgli arbitrariamente l'identità.

### 2. Capacità coerenti con la scheda
La scheda prevale sull'ispirazione. Le caratteristiche mentali vincolano comprensione,
deduzione, percezione e comunicazione secondo la loro funzione nelle regole.
Non si alzano statistiche per giustificare una personalità e non si riducono tutte
le capacità mentali a un unico valore. Un PNG con Intelligenza 3 può testimoniare
un fatto percepito senza ricostruire un complotto come un investigatore geniale.
Punteggi bassi non impongono caricature. Soglie e modalità tecniche restano al design;
questa spec non introduce nuove regole numeriche o successi automatici.

### 3. Verità, conoscenze, credenze e menzogne
La verità del mondo non coincide con ciò che il PNG sa o crede.
Un PNG può dedurre, sbagliare, essere ingannato o mentire. Una deduzione rimane
ipotesi finché non è stabilita come fatto; una testimonianza falsa può alimentare
una credenza, non cambiare la verità del mondo. Una menzogna intenzionale non deve
diventare automaticamente un ricordo autentico del suo autore.
Le parole del PNG non sono da sole autorità per creare fatti canonici.

### 4. Acquisizione e isolamento delle informazioni
Ogni nuova conoscenza deriva da un evento preciso: percezione, conversazione,
comunicazione o informazione fornita dal GM secondo il mondo di gioco.
Si conservano fonte, destinatario e momento di acquisizione. Il passato iniziale
stabilito è distinto da ciò che viene appreso durante il gioco.
Un PNG assente non riceve aggiornamenti automatici; il fatto può essere già accaduto
senza essere noto al PNG. Una comunicazione tardiva cambia ciò che sa da quel momento,
non ciò che sapeva in passato. Un nome richiede una presentazione, ascolto o ragione
pregressa già stabilita; apparire nel contesto globale non è una fonte lecita.
Il vincolo copre contesto, memorie recuperate, riassunti e risultati degli strumenti.
L'agente non deve poter leggere segreti o ricordi altrui esclusi dalla sua conoscenza.

### 5. Passato e rivelazioni
Relazioni ed eventi pregressi rilevanti non si inventano retroattivamente per
facilitare la storia. Un segreto già stabilito può essere rivelato dopo; non si può
crearlo allora fingendo che esistesse prima. La spec non richiede di descrivere
in anticipo ogni dettaglio ornamentale irrilevante.
Quando emerge un argomento pertinente, il compagno considera le informazioni
importanti già note e ne parla oppure ha un motivo coerente per nasconderle,
come paura, promessa o interesse personale. Una dimenticanza tecnica non può
essere giustificata dopo inventando una precedente scelta di tacere.

### 6. Autonomia, mondo e regole
Il PNG decide intenzioni e parole; il motore verifica azioni ed esiti. Il GM gestisce
il mondo senza riscrivere arbitrariamente le decisioni del personaggio. Il GM può
trasmettere percezioni e conseguenze lecite, non dare onniscienza per comodità.
Le regole server mantengono l'autorità su dadi, schede, risorse e risultati.
Fuori scena il PNG persegue obiettivi quando passa tempo nel gioco o si verifica
un evento pertinente. Non è richiesta un'esecuzione continua di tutti gli agenti.
Le attività fuori scena rispettano gli stessi confini informativi.

### 7. Fallimenti e ripresa
Se l'agente non risponde o propone un'azione non valida, il problema viene segnalato
ed è possibile riprovare. Non si inventano al suo posto dialoghi o decisioni e non
si applicano azioni o ricordi derivati dal tentativo fallito.
Azioni già concluse restano valide e non vengono ripetute. La ripresa deve distinguere
esiti già applicati da proposte fallite; non azzera il mondo e non duplica effetti.
Transazioni, identificativi, visibilità dell'errore e meccanismo di ripresa sono
responsabilità della proposta tecnica, non API già decise in questa spec.

## Acceptance Scenarios
| ID | Scenario | Esito richiesto |
| --- | --- | --- |
| A1 | Uno sconosciuto incontra il protagonista senza fonte del suo nome | Non usa il nome come conoscenza acquisita; dopo una presentazione può usarlo |
| A2 | Un PNG non era presente a un evento e lo apprende più tardi da un messaggero | Nessun ricordo prima della consegna; fonte e momento conservati dopo |
| A3 | Indagine sulla vittima, senza corrispondenza stabilita col compagno | Il compagno non inventa lettere pregresse per aiutare la trama |
| A4 | Corrispondenza già stabilita e nota al compagno | Considera il fatto quando pertinente; eventuale reticenza ha motivo coerente, non retroattivo |
| A5 | Un testimone mente e il PNG gli crede | Credenza, origine e verità restano distinte; nessuna riscrittura canonica |
| A6 | Il PNG deduce un colpevole da indizi incompleti | La conclusione può essere sbagliata e non viene promossa automaticamente a fatto |
| A7 | Ispirazione da investigatore brillante, Intelligenza 3 | Adattamento alla scheda, nessun aumento di statistiche o deduzione geniale ingiustificata |
| A8 | PNG ispirato a un personaggio noto | Nessuna importazione di ricordi, poteri o relazioni dell'opera; comportamento originale coerente |
| A9 | Tradimento realmente vissuto dal PNG | Evoluzione riconoscibile e motivata, non sostituzione improvvisa della personalità |
| A10 | Tempo di gioco trascorso con PNG fuori scena | Obiettivi progrediscono su eventi pertinenti, senza conoscenza degli eventi non ricevuti |
| A11 | Proposta di azione con esito contrario alle regole | Motore rifiuta; narratore non dichiara il successo ignorando il risultato |
| A12 | Timeout o azione non valida dopo un effetto già concluso | Errore visibile e retry; nessun dialogo sostitutivo, nuovo ricordo spurio o effetto duplicato |
| A13 | Riassunto, salvataggio e ripresa | Conoscenze e tempi restano coerenti; nessuna contaminazione tra memorie |
| A14 | Avvio della prima versione | Nuova campagna separata; partita attuale e Kokoro non modificati |

## Verification Strategy
Questi sono controlli da implementare, non risultati di test:
- Unit: selezione conoscenze per PNG/momento, separazione fatti-credenze, vincoli
  della scheda e avanzamento su eventi.
- Integration: percorsi completi di contesto, memoria, strumenti e persistenza;
  rifiuti, timeout e ripresa senza duplicazioni di effetti già applicati.
- System: breve indagine con pochi PNG, indizi privati e comunicazioni ritardate;
  ripetere dopo distrazioni, riassunti, salvataggio e riavvio.
- Manuale: valutazione di personalità distinte e reazioni coerenti, anche in italiano.
  Confrontare più esecuzioni del sistema attuale e della proposta sul medesimo modello.
- Separare test deterministici sull'accesso ai dati da controlli sul testo generato:
  l'isolamento del contesto non prova l'assenza assoluta di invenzioni del modello.
- Misurare errori, chiamate, token e latenza; una valutazione media positiva non
  compensa una fuga di segreti. Nessuna prova live a pagamento implicitamente autorizzata.

## Alternatives and Risks
Un solo narratore istruito a rispettare i PNG è più semplice ma non offre il confine
richiesto. Schede descrittive più ricche migliorano l'interpretazione, non provano
l'isolamento. Agenti distinti introducono coordinamento, latenza e consumo da misurare.
La ricerca suggerisce tecniche, non garantisce coerenza su campagne lunghe.
La convalida dei dialoghi deve rispettare bugie e deduzioni lecite senza normalizzare
fatti inventati: progettazione e prove spettano al ticket 02.

## Out of Scope and Compatibility
Importazione o migrazione di campagne esistenti, modifica della partita attuale,
traduzione completa, integrazione Pi, sostituzione di Kokoro, pubblicazione e deploy.
Nessuna compatibilità retroattiva aggiunta per inferenza. Modifiche distruttive a dati
esistenti non sono autorizzate. Nessuna API, schema DB, modello o framework scelto qui.

## Gates
- Attempt: lavoro documentale fino all'handoff.
- Budget, tempo per attempt e massimo attempts: nessuno impostato.
- Approvazioni: comportamenti sopra confermati con le risposte in Decision Provenance.
  Nessun gate comportamentale residuo rilevato per questa spec; spesa esterna,
  migrazioni di dati esistenti, pubblicazione, deploy e merge non autorizzati.
- Versione esatta: nessuna richiesta; la base osservata è un riferimento di evidenza.
- Vincoli rilevati: richieste dell'utente, AGENTS.md, CLAUDE.md, README.md,
  docs/configuration.md e mappa; nessun ulteriore blocco rilevato in questi materiali.
- La conferma dei requisiti non dimostra implementazione o isolamento runtime.

## Next Step
Il ticket 02 può usare questo contratto per una proposta tecnica con una prima slice
end-to-end e test causali. Non ripetere le domande già confermate; riportare soltanto
nuove decisioni materiali eventualmente emerse. Nessun runner avviato.
