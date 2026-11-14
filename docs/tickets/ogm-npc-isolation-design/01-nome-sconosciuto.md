---
ticket_schema: 1
ticket_id: "01"
execution_mode: AFK
blocked_by: []
---

# Il nome sconosciuto: primo agente PNG isolato

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-unknown-name`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Prima slice end-to-end di Target Architecture §1, §2, §4, §5, §7 della spec: registro
delle conoscenze per PNG (tabella journaled), `perceive` per le presentazioni in scena,
`contextFor` minimo (scheda, personalità, proprio registro, scena percepita), `propose` per
un solo PNG interlocutore durante il turno, con fallimento visibile e retry. Solo per una
nuova campagna di prova. Scenari A1, A12 (parte), A14 di [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## Acceptance Criteria
- [x] Uno sconosciuto senza presentazione o fonte non riceve il nome del protagonista nel proprio contesto (test deterministico).
- [x] Dopo una presentazione in scena il nome entra nel registro del PNG con fonte e tempo di gioco, e compare nel contesto.
- [x] Il contesto del PNG non contiene prompt del GM, fatti globali né registri di altri PNG (test).
- [x] Le parole/azioni del PNG passano dalla proposta al motore esistente; nessuno strumento PNG muta stato direttamente.
- [x] Timeout o proposta invalida: errore visibile, retry possibile, nessun ricordo o effetto creato dal tentativo fallito.
- [x] La nuova tabella è classificata nel journal; revert del turno rimuove le conoscenze che ha aggiunto.
- [x] Le campagne esistenti mantengono il comportamento attuale.

## Frontier
Ready. File condivisi con i ticket successivi: `src/lib/dm/turn.ts`, `src/lib/dm/social-tools.ts`, `src/lib/db/turn-journal.ts`.

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
1. Leggere .github/CONTRIBUTING.md e la guida Next.js locale indicata da AGENTS.md prima del codice.
2. Aggiungere tabella e accesso DB del registro conoscenze; classificarla nel journal. Checkpoint: `test-turn-journal` verde.
3. Implementare `npc-mind-logic.ts` puro (selezione contesto, regole sorgente) e il modulo `NpcMind` con `perceive`, `contextFor`, `propose`, `commit`.
4. Registrare le presentazioni come eventi percepiti dai PNG presenti in scena.
5. Nel turno, per il PNG interlocutore chiamare `propose` e passare l'esito al motore; il narratore non riscrive le parole.
6. Gestire timeout/invalidità con stati `proposed|ruled|committed|failed` e il retry esistente.
7. Abilitare il comportamento per le nuove campagne senza toggle utente; documentare la scelta.

## Testing Plan
Unit: `npc-mind-logic` (nome escluso senza fonte, incluso dopo presentazione, nessun registro altrui).
Integration: turno con PNG che fallisce → nessun ricordo; retry senza duplicati; revert del turno.
Regressione: `scripts/test-turn-journal.mjs`, `scripts/test-witness.mjs`, typecheck e lint del repository.
Manuale: nuova campagna di prova in italiano con modello locale o harness; nessuna API a pagamento.
Test proposti, non eseguiti.

## Out of Scope
- Notizie tardive, fuori scena, credenze, validazione dell'output, compagni del party.
- Migrazione della partita esistente.

## Handoff
Registro `npc_memories` + `npc_proposals` (journaled), `npc_speak` per i PNG di primo grado, contesto costruito solo dal registro. Test: nome escluso prima della presentazione e incluso dopo; nessun prompt GM, fatto o registro altrui; fallimento e JSON invalido senza ricordi, retry singolo; revert del turno; vecchie campagne senza strumenti (`gameSettings.npcMinds` solo sulle nuove).

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (35 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
