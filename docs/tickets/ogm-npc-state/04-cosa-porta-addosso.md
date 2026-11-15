---
ticket_schema: 1
ticket_id: "04"
execution_mode: AFK
blocked_by:
  - "01"
---

# Cosa porta addosso

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state-04`
- Role: `ticket`
- Parent: [ogm-npc-state.md](../../specs/ogm-npc-state.md)

## Parent Spec
[ogm-npc-state.md](../../specs/ogm-npc-state.md)

## What to Build
Il Master può segnare gli oggetti rilevanti che un PNG porta e se è stato
disarmato, e li ritrova a ogni turno. Copre «Porta» e la regola 6 della spec.

## Acceptance Criteria
- [ ] `npc_state` accetta `carries` (elenco che sostituisce il precedente, al massimo 8 voci brevi) e `disarmed` vero/falso.
- [ ] Un elenco più lungo o una voce oltre 60 caratteri sono rifiutati con il limite indicato.
- [ ] La riga del PNG nell'elenco del Master riporta «disarmato» e ciò che porta, solo se presenti.
- [ ] Un PNG senza oggetti segnati ha la riga identica a prima.

## Frontier
Blocked by 01.

## Gates
- Attempt: questo ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: merge sul `main` del fork e riavvio del server coperti dalla spec; riavvio solo senza turni attivi; mai lavorare nel checkout della partita.
- Exact version: nessuna.
- Existing blocks: nessuno trovato.

## Step-by-Step Implementation Plan
1. Aggiungere `carries` e `disarmed` a `NpcState`, con validazione nella logica pura.
2. Estendere lo schema dello strumento e il testo della riga.
3. Una frase in `prompt-rules.ts`: si segnano solo oggetti che contano per la storia (prove, chiavi, armi tolte), non l'equipaggiamento ordinario.

## Testing Plan
- `scripts/test-npc-state.mjs`: limiti, sostituzione dell'elenco, testo della riga.
- `npx tsc --noEmit`, `npm run lint`.

## Out of Scope
- Passaggio automatico di oggetti tra PNG e schede dei personaggi giocanti.
- Regole di ingombro o valore.
