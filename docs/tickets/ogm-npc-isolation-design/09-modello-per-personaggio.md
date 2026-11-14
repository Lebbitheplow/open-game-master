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

## Handoff
Colonna `npcs.mind_model_json` (`getNpcMindModel`/`setNpcMindModel`, journal automatico della riga, esclusa dal bundle del workshop). `askMind` passa la scelta come `mindChoice` a `requestUtilityMessage`; sul percorso del programma agente (`utilityOnAgent`) la chiamata porta `choice` al bridge, dove `chosenRun` la verifica contro `probeHarness(...).models`: un modello o uno sforzo non più offerto ricade su quello del tavolo con un `console.warn`. `model_calls` registra il modello scelto. Il narratore e le Comparse non passano scelte. Route `companions/[characterId]/mind` (GET/PATCH, zod, `requireStoryAuthority`), controllo `CompanionMind.tsx` («Thinks with»: modello + sforzo) nella lista compagni della lobby e nella scheda del compagno; si mostra solo con le menti attive, a chi guida la storia e quando le menti girano su un programma agente (altrove non c'è niente da scegliere). Giustificazione del controllo (AGENTS.md): senza, tutte le menti costano e ragionano come il modello utility; serve a chi vuole un compagno più profondo o più economico; nessun default lo sostituisce.

Limiti: la scelta vale solo quando le menti del tavolo girano su un programma agente (Codex ecc.); con fornitore locale o personalizzato il controllo non appare. I PNG di primo grado che non sono compagni hanno la colonna e il percorso ma nessun controllo nell'interfaccia (il ticket chiede la scheda del compagno).

Test: `node scripts/test-npc-mind-model.mjs` (6 scenari sul programma agente finto: scelta usata, default del tavolo, solo sforzo, modello sparito con nota nel log, narratore intatto, revert e riavvio; rimuovendo `mindChoice` falliscono 3). Regressione: typecheck, eslint, test-npc-mind (45), test-npc-mind-fight-wake, test-turn-journal, test-harness-* (logic, turn, completion-slots, late-start, run-dir, pictures), test-workshop-bundle, test-companion-command, test-create-campaign-options, test-enforce-sweep-lifecycle-revert. Vitest completo: 43 file in errore; i 41 della base più `test-text-comparisons` (voce mancante per il controllo `two-handed` del ticket 08) e `test-partial-updates` (attendeva `npcMinds: false` sulle campagne nuove, superato da `9cc2b25de`), entrambi corretti e rieseguiti verdi. Manuale con Codex reale su `localhost:3100`: la scheda di Brann elenca gli 8 modelli Codex con i loro sforzi; scelto GPT-6-Luna/low, il turno successivo della mente è registrato su `gpt-6-luna` senza ripiego. Lo sforzo usato dal vivo non è registrato nel database (coperto dal test). Branch locale `npc-agents`, non pubblicato.
