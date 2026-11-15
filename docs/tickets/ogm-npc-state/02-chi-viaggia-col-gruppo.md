---
ticket_schema: 1
ticket_id: "02"
execution_mode: AFK
blocked_by:
  - "01"
---

# Chi viaggia col gruppo

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state-02`
- Role: `ticket`
- Parent: [ogm-npc-state.md](../../specs/ogm-npc-state.md)

## Parent Spec
[ogm-npc-state.md](../../specs/ogm-npc-state.md)

## What to Build
Il luogo di chi viaggia con il gruppo si aggiorna da solo, e chi agisce in scena
risulta in scena. Copre «Con il gruppo» e le regole 2 e 3 della spec.

## Acceptance Criteria
- [ ] `npc_state` accetta `withParty` vero/falso.
- [ ] Quando il luogo corrente del gruppo cambia, ogni PNG con `withParty` vero ha lo stesso luogo subito dopo, senza altre chiamate.
- [ ] Un PNG prigioniero di un personaggio giocante, o di un PNG che è con il gruppo, segue il gruppo finché resta prigioniero; liberato, resta dove si trova.
- [ ] Un PNG che parla con `npc_speak` e il cui luogo registrato è diverso da quello corrente viene spostato nel luogo corrente.
- [ ] Un PNG segnato come lontano (`away`) non viene spostato dalla regola precedente e non segue il gruppo.
- [ ] Chi è con il gruppo compare nella parte alta dell'elenco del Master, con la dicitura «con il gruppo».

## Frontier
Blocked by 01.

## Gates
- Attempt: questo ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: merge sul `main` del fork e riavvio del server coperti dalla spec; riavvio solo senza turni attivi; mai lavorare nel checkout della partita.
- Exact version: nessuna.
- Existing blocks: nessuno trovato.

## Step-by-Step Implementation Plan
1. Aggiungere `withParty` a `NpcState` e alla logica pura; derivare «segue il gruppo» da `withParty` o dalla custodia.
2. Trovare il punto unico in cui il server cambia il luogo corrente della campagna e, lì, aggiornare il luogo di chi segue. Checkpoint: test su cambio di luogo.
3. Nel punto in cui `npc_speak` viene risolto, allineare il luogo di chi agisce, saltando chi è `away`.
4. Aggiornare ordinamento e riga dell'elenco.

## Testing Plan
- `scripts/test-npc-state.mjs`: cambio di luogo con e senza `withParty`, prigioniero che segue, liberazione, PNG `away`.
- `scripts/test-npc-mind.mjs` verde.
- `npx tsc --noEmit`, `npm run lint`.
- Con modello vero su copia del database: partenza per Roccanera con due prigionieri; dopo il viaggio entrambi risultano nel luogo del gruppo.

## Out of Scope
- Spostamenti autonomi dei PNG fuori scena.
- Guardia sulla narrazione (06).
