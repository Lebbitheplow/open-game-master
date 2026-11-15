---
ticket_schema: 1
ticket_id: "01"
execution_mode: AFK
blocked_by: []
---

# Prigioniero e condizione

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state-01`
- Role: `ticket`
- Parent: [ogm-npc-state.md](../../specs/ogm-npc-state.md)

## Parent Spec
[ogm-npc-state.md](../../specs/ogm-npc-state.md)

## What to Build
Il Master può dichiarare che un PNG è prigioniero (di chi), come è vincolato e in
che condizione è; il server lo registra e glielo ripresenta a ogni turno.
Copre «Scheda» (custodia, vincoli, condizione), regole 1 e 4, e «Cosa vede chi —
Master» della spec.

## Acceptance Criteria
- [ ] Lo strumento `npc_state` accetta nome del PNG, custodia (`free` o `captive` con `heldBy`), vincoli (`none`, `bound`, `chained`, `locked_up`) e condizione (`up`, `wounded`, `unconscious`, `dead`); ogni campo è facoltativo e lascia invariato ciò che non è dato.
- [ ] Un valore fuori elenco, un PNG sconosciuto o `captive` senza `heldBy` sono rifiutati con una frase che dice cosa correggere; nulla viene scritto.
- [ ] Custodia `free` azzera anche i vincoli.
- [ ] `npc_speak` per un PNG `dead` o `unconscious` è rifiutato con la ragione.
- [ ] La riga del PNG nell'elenco del Master riporta lo stato diverso dal default; un PNG al default ha la riga identica a oggi.
- [ ] Un prigioniero compare nella parte alta dell'elenco anche se il suo luogo non coincide con quello corrente.
- [ ] Un database esistente si apre senza errori e ogni PNG risulta libero, senza vincoli, in piedi.

## Frontier
Ready.

## Gates
- Attempt: questo ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: merge sul `main` del fork e riavvio del server coperti dalla spec; riavvio solo senza turni attivi; mai lavorare nel checkout della partita.
- Exact version: nessuna.
- Existing blocks: nessuno trovato; ogni file nuovo sotto `src/lib` va classificato in `scripts/name-lookups.json`.

## Step-by-Step Implementation Plan
1. Aggiungere a `npcs` una colonna `state_json` con default vuoto e il tipo `NpcState` con i suoi default; lettura e scrittura in `src/lib/db/npcs.ts`. Checkpoint: database esistente si apre.
2. Scrivere la logica pura (validazione, coerenza, testo della riga) in un file nuovo `src/lib/dm/npc-state-logic.ts`. Checkpoint: test unitari verdi.
3. Dichiarare `npc_state` accanto a `set_npc` in `src/lib/dm/social-tools.ts`, registrarlo in `catalog-world.ts`, `tool-profiles.ts` e `invoke-dispatch.ts` come gli altri strumenti sociali.
4. Aggiungere lo stato alla riga «Tracked NPCs» in `src/lib/dm/prompt.ts` e far salire i prigionieri in `npc-rank-logic.ts`.
5. Rifiutare `npc_speak` per morti e svenuti nel punto in cui lo strumento viene risolto.
6. Una frase in `prompt-rules.ts`: alla cattura, liberazione, svenimento o morte di un PNG tracciato si chiama `npc_state`.

## Testing Plan
- Nuovo `scripts/test-npc-state.mjs`: validazione, rifiuti, azzeramento dei vincoli, testo della riga, ordinamento.
- `scripts/test-npc-mind.mjs` resta verde (rifiuto di `npc_speak`).
- `npx tsc --noEmit`, `npm run lint`.
- Con modello vero su copia del database: rigiocare la cattura al mulino; il Master chiama `npc_state`.

## Out of Scope
- Luogo che segue il gruppo (02), rinomina (03), oggetti (04), vista delle menti (05), guardia (06).
- Interfaccia per il giocatore.
