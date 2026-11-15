---
ticket_schema: 1
ticket_id: "06"
execution_mode: AFK
blocked_by:
  - "01"
  - "02"
---

# Narrazione coerente con la scheda

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state-06`
- Role: `ticket`
- Parent: [ogm-npc-state.md](../../specs/ogm-npc-state.md)

## Parent Spec
[ogm-npc-state.md](../../specs/ogm-npc-state.md)

## What to Build
Se la prosa del Master contraddice la scheda di un PNG in scena, o racconta una
cattura senza registrarla, il Master viene rimandato a correggersi una volta.
Copre «Guardia sulla narrazione» della spec.

## Acceptance Criteria
- [ ] Con un PNG legato in scena, una prosa in cui impugna un'arma o se ne va liberamente fa ripartire il Master una volta, con una frase che nomina la contraddizione.
- [ ] Una prosa in cui un PNG tracciato viene catturato, legato, steso o ucciso senza una chiamata a `npc_state` nello stesso turno fa ripartire il Master una volta.
- [ ] Il gruppo che cambia luogo lasciando un proprio prigioniero senza dichiararlo fa ripartire il Master una volta.
- [ ] Dopo il secondo tentativo la risposta passa comunque; un errore o un silenzio del modello di utilità lascia passare la risposta.
- [ ] In una scena senza PNG tracciati la guardia non fa alcuna chiamata al modello.
- [ ] La frase di rimando non arriva mai al giocatore.

## Frontier
Blocked by 01 and 02.

## Gates
- Attempt: questo ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: merge sul `main` del fork e riavvio del server coperti dalla spec; riavvio solo senza turni attivi; mai lavorare nel checkout della partita.
- Exact version: nessuna.
- Existing blocks: nessuno trovato.

## Step-by-Step Implementation Plan
1. Logica pura in `npc-state-logic.ts`: quando la guardia è dovuta e il testo della domanda al modello di utilità, sul modello della guardia delle conoscenze (`voice-knowledge-logic.ts`).
2. Chiamata al modello di utilità in un file accanto a `voice-knowledge.ts`, con lo stesso trattamento di errori e tempi.
3. Agganciare la guardia in `src/lib/dm/turn.ts` dove già passano le altre, con un solo rimando per turno.

## Testing Plan
- Nuovo `scripts/test-npc-state-guard.mjs` con un modello finto: i tre casi di rimando, il passaggio al secondo tentativo, l'errore del modello, la scena vuota.
- `scripts/test-voice-knowledge.mjs` e `scripts/test-npc-mind.mjs` verdi.
- `npx tsc --noEmit`, `npm run lint`.
- Con modello vero su copia del database: la cattura al mulino rigiocata senza la frase di regola del ticket 01 viene comunque registrata.

## Out of Scope
- Correzione automatica della scheda a partire dalla prosa.
- Controllo dello stato dei personaggi giocanti.
