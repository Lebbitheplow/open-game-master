---
ticket_schema: 1
ticket_id: "05"
execution_mode: AFK
blocked_by:
  - "01"
  - "02"
---

# Le menti vedono chi hanno davanti

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state-05`
- Role: `ticket`
- Parent: [ogm-npc-state.md](../../specs/ogm-npc-state.md)

## Parent Spec
[ogm-npc-state.md](../../specs/ogm-npc-state.md)

## What to Build
Una mente di primo livello riceve, per ogni altro personaggio presente, lo stato
che vedrebbe guardandolo, e il proprio. Copre «Cosa vede chi — Menti di primo
livello» della spec.

## Acceptance Criteria
- [ ] Il contesto di una mente elenca, per ogni altro PNG nello stesso luogo, vincoli, condizione, custodia e disarmo diversi dal default.
- [ ] La mente riceve il proprio stato («sei in catene, prigioniero di …»).
- [ ] Lo stato di un PNG in un altro luogo non compare mai nel contesto.
- [ ] Gli oggetti segnati in `carries` di un altro PNG non compaiono mai nel contesto.
- [ ] Una mente il cui stato è `unconscious` o `dead` non riceve turni garantiti di scena.
- [ ] Nessun testo aggiunto nomina livelli o dice quali PNG hanno una mente.

## Frontier
Blocked by 01 and 02 (serve un luogo affidabile per decidere chi è presente).

## Gates
- Attempt: questo ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: merge sul `main` del fork e riavvio del server coperti dalla spec; riavvio solo senza turni attivi; mai lavorare nel checkout della partita.
- Exact version: nessuna.
- Existing blocks: nessuno trovato; il divieto di rivelare identità e conteggi delle menti resta in vigore.

## Step-by-Step Implementation Plan
1. In `npc-state-logic.ts`, una funzione pura che da uno stato produce la frase «visibile» (senza `carries`).
2. In `src/lib/dm/npc-mind.ts` e `npc-mind-logic.ts`, aggiungere al contesto della mente il blocco dei presenti e il proprio stato.
3. Escludere svenuti e morti dai turni garantiti nel punto in cui il server calcola a chi è dovuto un turno.

## Testing Plan
- `scripts/test-npc-mind.mjs`: nuovi casi per presenti, assenti, oggetti nascosti, turni non dovuti.
- `npx tsc --noEmit`, `npm run lint`.
- Con modello vero su copia del database: Mara, interrogata, parla di Rugo come di un uomo legato senza che il Master glielo dica.

## Out of Scope
- Percezione di stati nascosti con prove di abilità.
