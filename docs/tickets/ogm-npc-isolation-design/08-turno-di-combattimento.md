---
ticket_schema: 1
ticket_id: "08"
execution_mode: AFK
blocked_by:
  - "07"
---

# Il compagno sceglie il proprio turno di combattimento

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-combat-turn`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md) §11 (decisione dell'utente:
opzione 1, «la mente decide, il narratore esegue»).

## What to Build
Con le menti attive, il turno di combattimento di un compagno che nessun giocatore comanda è
scelto dalla sua mente, non dal narratore. La mente conosce tutta la propria scheda (punti
ferita, CA, caratteristiche, abilità, armi, oggetti, incantesimi e slot, risorse, privilegi,
condizioni) e del combattimento solo ciò che vede: nemici con salute approssimativa e
condizioni, alleati, distanze sulla mappa, movimento rimasto. Il narratore esegue l'intenzione
con gli strumenti normali; il server rifiuta le azioni del compagno finché la mente non ha
scelto, e un'azione non permessa torna alla mente con il motivo del rifiuto. Nella scheda del
compagno l'opzione «The GM» diventa «Its own mind».

## Acceptance Criteria
- [x] La mente di un compagno riceve la propria scheda completa e mai statistiche o punti ferita esatti dei nemici.
- [x] Nel turno di combattimento del compagno, prima della scelta della mente, il server rifiuta le sue azioni e chiede `npc_speak`.
- [x] Dopo la scelta le azioni passano; un rifiuto del motore è riportato alla mente con `npc_speak`.
- [x] Un compagno comandato da un giocatore, a terra o in una campagna senza menti non è toccato.
- [x] La scheda del compagno mostra «Its own mind» al posto di «The GM» quando le menti sono attive.

## Frontier
Dependency-ready: 07 è chiuso. Condivide `src/lib/dm/npc-mind.ts`, `src/lib/dm/turn.ts`.

## Gates
- Attempt: lavoro del ticket fino all'handoff; budget, tempo e massimo attempts: nessuno impostato.
- Approvazioni: richiesta dell'utente («1»). Nessuna spesa API, migrazione di campagne esistenti,
  pubblicazione, deploy o merge autorizzati.
- Versione esatta: nessuna; base `73a45ca2e`.
- Vincoli rilevati: come ticket 07 (moduli puri, errori retry/refused, journal, nessun nuovo toggle).

## Step-by-Step Implementation Plan
1. Aggiungere la scheda (`describeSheet`) e la vista del combattimento al contesto della mente.
2. Aggiungere il cancello nel turno del narratore per le azioni del compagno non ancora scelte.
3. Regola per il narratore ed etichetta nella scheda del compagno.
4. Test deterministici.

## Testing Plan
Integration in `scripts/test-npc-mind.mjs`: scheda nella mente, cancello prima/dopo la scelta,
comandato e campagna senza menti esclusi. Regressione: typecheck, eslint, sweep collegati, vitest.

## Out of Scope
- La mente che chiama da sola gli strumenti di combattimento (opzione 2).
- Le Comparse.

## Handoff
`identityOf` aggiunge alla mente la scheda completa (`describeSheet`, compatta); `fightView` le dà il campo come lo vede (`healthWord`, distanze, niente PF né nemici nascosti). `mindTurnRefusal` (in `resolveModelCall` di `turn.ts`) rifiuta con retry le azioni del compagno nel suo turno finché non c'è una proposta della sua mente nel turno corrente; `npc_speak` restituisce `fightTurn` con l'istruzione di eseguire e, se rifiutata, richiedere. Regola in `NPC_MINDS_RULES`; etichetta «Its own mind» in `CompanionCommand.tsx` (prop da `SidePanelRouter` → `PartyPanel`).

Test: `node scripts/test-npc-mind.mjs` (42 scenari, 3 nuovi: cancello e contesto, esclusioni, turno completo del narratore con rifiuto e scelta). Verificati typecheck, eslint, name-lookups, turn-pointer-readers (il turno si legge con `ownTurnOf`), dice-sites, journal, catalogo, sweep e test dei compagni (dash, conscience, claims, off-turn, player-word, reaction-hits). Vitest completo rieseguito sullo stato finale (1180 file): 41 in errore, esattamente quelli della base, nessuno nuovo (turn-pointer-readers, emerso al primo giro, è corretto). Branch locale `npc-agents`, non pubblicato. Nessuna prova con un modello reale né nel browser.