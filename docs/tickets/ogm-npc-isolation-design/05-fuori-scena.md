---
ticket_schema: 1
ticket_id: "05"
execution_mode: AFK
blocked_by:
  - "02"
---

# Attività dei PNG fuori scena

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-offscreen`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Target Architecture §6: nel `world-tick` esistente, quando passa tempo di gioco o arriva un
evento pertinente, i PNG con obiettivi pertinenti chiamano `propose`; budget di chiamate per tick;
stessi confini informativi. Scenario A10.

## Revisione (decisione dell'utente)
I compagni lontani dal party sono il caso reale di primo grado fuori scena: calcolo pigro
con recupero quando la storia li tocca (spec §10). Criteri aggiunti sotto.

## Acceptance Criteria
- [x] Con tempo trascorso, un PNG fuori scena fa progredire un obiettivo tramite proposta validata dal motore.
- [x] Il PNG non conosce eventi che non gli sono stati consegnati.
- [x] Il numero di chiamate per tick è limitato e misurato (chiamate, token, latenza).
- [x] Un fallimento fuori scena non produce effetti né blocca il turno principale.
- [x] Un compagno lasciato indietro è segnato lontano con luogo e istante, e non ascolta la scena.
- [x] Quando la storia tocca il compagno o un PNG del suo luogo, il tempo trascorso viene recuperato a passi limitati, con esito deciso dal d20 del motore e ricordato dalla mente.
- [x] Cambio di scena (`away: true`) e ricongiungimento funzionano; dopo il ricongiungimento il compagno ricorda ciò che ha fatto.
- [x] Un recupero fallito conserva i passi giocati, mostra l'errore e viene annullato dal revert del turno.

## Frontier
Dependency-blocked da 02.

## Gates
- Attempt: lavoro del ticket fino all'handoff; budget, tempo e massimo attempts: nessuno impostato.
- Approvazioni: richiesta di creare i ticket ricevuta («Fallo»); l'esecuzione richiede una richiesta esplicita.
  Nessuna spesa API, migrazione di campagne esistenti, pubblicazione, deploy o merge autorizzati.
- Versione esatta: nessuna; base di riferimento `ff8635a2bbc6baa7f06388b9aa86bfa2bbb0f16d`.
- Vincoli rilevati: AGENTS.md e .github/CONTRIBUTING.md (moduli puri `*-logic.ts`, zod sulle route,
  errori degli strumenti che dicono retry o refused, ogni nuova tabella classificata in
  `src/lib/db/turn-journal.ts` altrimenti `scripts/test-turn-journal.mjs` fallisce,
  nessun nuovo toggle senza giustificazione). Partita esistente e Kokoro intatti.

## Step-by-Step Implementation Plan
1. Selezionare i PNG pertinenti nel tick (logica pura).
2. Invocare `propose`/`commit` con il budget per tick.
3. Registrare le misure di costo.

## Testing Plan
Unit: selezione e budget. Integration: tempo trascorso → progresso; evento non consegnato → ignoto.
Regressione: test esistenti di world-tick e npc-agency, typecheck, lint.
Test proposti, non eseguiti.

## Out of Scope
- Simulazione continua di tutti i PNG.

## Handoff
`runOffscreenMinds` è collegato al timeskip, non atteso e limitato a `OFFSCREEN_BUDGET`, e vale solo per il primo grado. La mente propone un'intenzione e il motore decide il progresso con il d20 di `advanceSessionGoal`; il tick generico salta quei PNG. Chiamate, token e latenza sono in `npc_proposals`. Il passaggio automatico vale per i PNG di primo grado non compagni, oggi assenti in gioco reale. Per i compagni lontani: `away_json`, `catchUp` e i trigger in `npc_speak`, `npc_inform`, `move_party` (`party-split.ts`, `turn.ts`); 4 scenari dedicati in `test-npc-mind.mjs`.

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (39 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
