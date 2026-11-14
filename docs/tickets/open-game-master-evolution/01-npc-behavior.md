---
ticket_schema: 1
ticket_id: "01"
execution_mode: HITL
blocked_by: []
---

# Confermare il comportamento degli agenti PNG

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-behavior-ticket`
- Role: ticket
- Parent: [Mappa](../../specs/open-game-master-evolution-wayfinder.md)
- Produces: [Contratto comportamentale](../../specs/ogm-npc-behavior.md)

## Parent Spec
[Mappa Wayfinder](../../specs/open-game-master-evolution-wayfinder.md), Destination
e Frontier / Blocking Edges.

## What to Build
Un contratto comportamentale confermato dall'utente, non codice.
Colloquio grilling seguito dalla registrazione delle decisioni con to-spec.

## Acceptance Criteria
- [x] Ogni decisione materiale del contratto ha una risposta umana attribuibile.
- [x] Sono definiti deduzioni/credenze, comunicazioni e tempi di acquisizione,
      attività fuori scena, partite nuove/esistenti, autorità GM/PNG e fallimenti.
- [x] Gli esempi distinguono conoscenza, supposizione e verità del mondo.
- [x] Il contratto è confermato prima della spec durevole; nessun default vale come consenso.
- [x] Spec e mappa si collegano senza dichiarare implementato il comportamento.

## Frontier
Colloquio concluso e output documentato. La spec conserva le conferme esplicite
in Decision Provenance, incluse personalità ispirate ma originali, evoluzione e
prevalenza della scheda. Il consenso finale «Si va bene» riguarda i fallimenti.
La dipendenza comportamentale di 02 è soddisfatta. 02 non è stato avviato.
Il mode HITL resta quello dell'envelope originario; nessun cambio amministrativo
di stato, merge o implementazione applicativa è implicito.

## Gates
- Attempt: lavoro fino all'handoff; budget, tempo e massimo attempts: nessuno impostato.
- Approvazioni: conferme comportamentali ottenute; nessuna spesa, migrazione,
  pubblicazione, deploy o merge autorizzati.
- Versione esatta: nessuna; vincoli ed evidenze sono quelli della mappa.
- Nessuna garanzia runtime viene dedotta dalla chiusura del colloquio.

## Step-by-Step Implementation Plan
1. Ricostruire domande e risposte: completato nel colloquio, senza trattare le raccomandazioni come consenso.
2. Usare grilling per le decisioni materiali: completato con risposte esplicite.
3. Registrare il contratto con to-spec: output collegato, scenari A1–A14 e rischi.
4. Aggiornare la mappa: prossimo passo 02, proposta tecnica ancora da svolgere.

## Testing Plan
Review documentale inline, non indipendente: confronto con le risposte dell'utente,
copertura delle decisioni e distinzione tra requisiti e implementazione.
Validare envelope canonico, dipendenze e collegamenti locali/reciproci.
Nessuna chiamata LLM o suite applicativa richiesta per il solo colloquio.
I test causali nella spec sono proposti, non eseguiti.

## Out of Scope
Codice, provider, scelta di un modello, traduzione, Pi, avvio del gioco,
modifica della campagna esistente.
