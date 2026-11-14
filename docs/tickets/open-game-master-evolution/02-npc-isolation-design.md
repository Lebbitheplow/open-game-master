---
ticket_schema: 1
ticket_id: "02"
execution_mode: AFK
blocked_by:
  - "01"
---

# Proporre l'isolamento tecnico degli agenti PNG

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-isolation-design-ticket`
- Role: ticket
- Parent: [Mappa](../../specs/open-game-master-evolution-wayfinder.md)
- Produces: [Proposta tecnica](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[Mappa Wayfinder](../../specs/open-game-master-evolution-wayfinder.md), Destination,
Evidence e Frontier / Blocking Edges. Input aggiuntivo: spec confermata prodotta da 01.

## What to Build
Con research e to-spec, una proposta basata sul codice che realizzi il contratto
confermato senza esporre all'agente PNG le informazioni escluse.
La spec prodotta avrà Parent verso questo ticket e Artifact ID stabile.

## Acceptance Criteria
- [x] Ogni ingresso informativo è mappato: prompt, storia, riassunti, ricordi,
      risultati degli strumenti, stato della scheda e conoscenze iniziali.
- [x] La proposta descrive identità PNG, selezione del contesto, strumenti consentiti,
      consegna degli eventi e persistenza, senza affidarsi soltanto a istruzioni nel prompt.
- [x] Sono separati prevenzione dell'accesso ai segreti e rischio residuo di invenzioni
      o deduzioni del modello; non è promessa infallibilità del testo generato.
- [x] Sono trattati autorità del GM, regole server, fallimenti e ripresa coerente
      secondo il contratto 01, con rischi di migrazione e consumo espliciti.
- [x] Sono proposti scenari di accettazione e una prima slice end-to-end,
      senza implementarla né chiamare servizi a pagamento.
- [x] Fonti, ipotesi e limiti sono distinguibili e la mappa rimanda all'output.

## Frontier
Completato a livello documentale: proposta in ogm-npc-isolation-design.md, basata su 01
e analisi statica. Nessun codice o test eseguito; nessuna nuova decisione comportamentale emersa.
Quando eseguito, se emerge una nuova decisione materiale, mantenerla aperta e
riportarla alla mappa; non inventare la risposta per completare la proposta.

## Gates
- Attempt: lavoro fino all'handoff; budget, tempo e massimo attempts: nessuno impostato.
- Dipendenza: contratto confermato di 01 ed evidenza durevole richiesti.
- Approvazioni: nessuna spesa, migrazione, pubblicazione, deploy o merge autorizzati.
- Versione esatta: nessuna; vincoli ed evidenze sono quelli della mappa.
- L'emissione di questo ticket non ne avvia l'esecuzione.

## Step-by-Step Implementation Plan
1. Validare 01 e leggere il suo output; identificare base corrente e differenze
   rispetto alla base dell'indagine.
2. Tracciare flusso GM/PNG nei moduli citati dalla mappa e relativi chiamanti.
   Completamento: fonti dati, punti di accesso e strumenti documentati con riferimenti.
3. Confrontare la proposta minima con le strutture esistenti; consultare
   documentazione corrente soltanto per contratti esterni effettivamente coinvolti.
4. Scrivere la proposta con to-spec e aggiornare la mappa.
   Completamento: copertura del contratto, prove proposte, rischi e domande residue espliciti.

## Testing Plan
Analisi statica e review documentale inline, non indipendente. Proporre test causali
con fatti-segnaposto: PNG assente, trasferimento tardivo, ricordo riassunto,
strumento che legge un altro PNG, riavvio e fallimento parziale.
Distinguere sempre test proposti da eseguiti. Nessuna prova live richiesta in questo ticket.

## Out of Scope
Implementazione o prototipo, creazione automatica di altri ticket, modifica del DB,
traduzione, integrazione Pi, chiamate AI, migrazione della partita in uso.
