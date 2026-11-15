---
ticket_schema: 1
ticket_id: "03"
execution_mode: AFK
blocked_by:
  - "01"
  - "02"
---

# Nome scoperto

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state-03`
- Role: `ticket`
- Parent: [ogm-npc-state.md](../../specs/ogm-npc-state.md)

## Parent Spec
[ogm-npc-state.md](../../specs/ogm-npc-state.md)

## What to Build
Quando la storia rivela il nome di un PNG finora tracciato con una descrizione
(«Uomo armato del mulino» → «Rugo»), il Master lo aggiorna e la persona resta la
stessa. Copre la regola 5 della spec e l'allineamento della campagna di prova.

## Acceptance Criteria
- [ ] `npc_state` accetta `revealedName`; il PNG prende quel nome e il precedente resta tra gli alias.
- [ ] Memorie, relazioni, livello, stato e voce restano attaccati allo stesso PNG dopo la rinomina.
- [ ] Un nome già usato da un altro PNG della campagna è rifiutato con la ragione; nulla cambia.
- [ ] Nominare il PNG con il vecchio nome in uno strumento continua a trovarlo.
- [ ] Nella campagna di prova, dopo l'allineamento, «Rugo» è prigioniero di Mara, legato, con il gruppo; Aldren è prigioniero di Mara, in catene, con il gruppo. Esiste una copia del database precedente alla modifica.

## Frontier
Blocked by 01 and 02 (l'allineamento usa custodia e «con il gruppo»).

## Gates
- Attempt: questo ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: merge sul `main` del fork e riavvio del server coperti dalla spec; riavvio solo senza turni attivi; mai lavorare nel checkout della partita. L'allineamento scrive nel database della partita: copia prima, solo senza turni attivi.
- Exact version: nessuna.
- Existing blocks: nessuno trovato.

## Step-by-Step Implementation Plan
1. Riusare `renameNpc` di `src/lib/db/npcs.ts` dal risolutore di `npc_state`; aggiungere il controllo sul nome già in uso.
2. Verificare che la ricerca per nome usata dagli strumenti passi dagli alias.
3. Una frase in `prompt-rules.ts`: quando un PNG tracciato rivela il suo nome, si usa `revealedName` invece di registrarne uno nuovo.
4. Dopo il merge: copia del database, poi allineamento di Rugo e Aldren con gli strumenti del server, non con SQL a mano.

## Testing Plan
- `scripts/test-npc-state.mjs`: rinomina, alias, collisione, memorie conservate.
- `npx tsc --noEmit`, `npm run lint`.
- Lettura dal database della partita dopo l'allineamento.

## Out of Scope
- Fusione di due PNG già registrati separatamente (esiste già la revisione manuale).
