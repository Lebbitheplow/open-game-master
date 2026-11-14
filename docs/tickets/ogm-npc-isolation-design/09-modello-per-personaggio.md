---
ticket_schema: 1
ticket_id: "09"
execution_mode: AFK
blocked_by:
  - "08"
---

# Modello e sforzo per ogni Personaggio

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-mind-model`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md) §9 (Personaggi). Decisione
dell'utente: si scelgono modello e sforzo di ragionamento, alla creazione dell'avventura e dopo.

## What to Build
Ogni Personaggio (PNG di primo grado, compagni compresi) può avere un proprio modello e un proprio
sforzo di ragionamento per la sua mente. Vuoto significa «come le menti del tavolo» (oggi il
modello utility, altrimenti quello del narratore), il comportamento attuale. La scelta è tra i
modelli e gli sforzi che il fornitore del tavolo dichiara (per Codex: `model/list` e i suoi
sforzi), non testo libero. Si imposta alla creazione dell'avventura, accanto a ogni compagno, e
dopo dalla scheda del compagno; vale dalla chiamata successiva della mente. Il valore è salvato
sul PNG (journaled), così revert e ripristino lo riportano.

## Acceptance Criteria
- [ ] Una mente con modello e sforzo propri chiama quel modello con quello sforzo; senza scelta usa il percorso del tavolo come oggi.
- [ ] Si possono scegliere solo modelli e sforzi offerti dal fornitore; un modello che non c'è più ricade sul percorso del tavolo con una nota nel log.
- [ ] La scelta si fa alla creazione dell'avventura e si cambia dopo dalla scheda del compagno, solo da chi guida la storia.
- [ ] Il narratore e le Comparse non sono toccati; revert del turno e riavvio conservano la scelta.

## Frontier
Dependency-ready dopo 08. Condivide `src/lib/dm/model.ts` (percorso utility), `src/lib/dm/npc-mind.ts`,
`CompanionCommand.tsx` / scheda compagno, creazione campagna.

## Gates
- Attempt: lavoro del ticket fino all'handoff; budget, tempo e massimo attempts: nessuno impostato.
- Approvazioni: richiesta dell'utente («modello e sforzo … sia all'inizio che dopo»). Nessuna spesa API,
  migrazione di campagne esistenti, pubblicazione, deploy o merge autorizzati.
- Versione esatta: nessuna; base `3235dff30`.
- Vincoli rilevati: AGENTS.md «Settings, options and toggles» (giustificare il controllo, mostrarlo solo
  quando può contare, accessibile); journal per la nuova colonna; zod sulle route.

## Step-by-Step Implementation Plan
1. Colonna `npcs.mind_model_json` (modello, sforzo) con lettura/scrittura e classificazione nel journal.
2. Override del percorso utility per una singola chiamata della mente, validato contro la lista del fornitore.
3. Route di modifica (zod) e controllo nella scheda del compagno; scelta nel flusso di creazione.
4. Test deterministici sul percorso scelto, sul ritorno al default e sul revert.

## Testing Plan
Integration in `scripts/test-npc-mind.mjs` (modello finto che registra modello e sforzo richiesti).
Regressione: test-turn-journal, test-harness-logic, typecheck, eslint, vitest. Manuale: due compagni
con modelli diversi in una campagna di prova.

## Out of Scope
- Modello per le Comparse o per il narratore (già nelle impostazioni del tavolo).
- Fornitori diversi da quello del tavolo per una singola mente.
