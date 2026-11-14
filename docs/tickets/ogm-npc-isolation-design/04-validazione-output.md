---
ticket_schema: 1
ticket_id: "04"
execution_mode: AFK
blocked_by:
  - "01"
---

# Segnalare nomi ed eventi non appresi nell'output

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-output-check`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Target Architecture §8: controllo post-generazione che segnala nomi propri o eventi citati
dal PNG e assenti dal suo registro e li tratta come affermazione/bugia, mai come nuovo fatto.
Riduce, non elimina, l'invenzione. Scenari A1 e A3.

## Acceptance Criteria
- [x] Un PNG che pronuncia un nome non appreso viene segnalato nella traccia del turno; il nome non entra nei registri di altri come fatto.
- [x] Lettere o relazioni pregresse non stabilite citate dal compagno non diventano fatti del mondo.
- [x] Bugie intenzionali e ipotesi lecite non vengono bloccate.
- [x] Il limite residuo (nessuna garanzia sul testo) è documentato.

## Frontier
Dependency-blocked da 01. Può proseguire in parallelo a 02 e 03; condivide `NpcMind.commit`.

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
1. Estrarre nomi/entità citati confrontandoli con roster e registro (logica pura).
2. Applicare la regola in `commit` e registrare l'esito nella traccia del turno.
3. Decidere solo azioni tecniche già previste dalla spec; nessuna nuova politica di blocco.

## Testing Plan
Unit: rilevamento nome non appreso e tolleranza delle bugie. Integration: compagno che inventa lettere → nessun fatto.
Regressione: typecheck, lint.
Test proposti, non eseguiti.

## Out of Scope
- Riscrittura automatica dei dialoghi.
- Garanzia di assenza di invenzioni.

## Handoff
I nomi propri non appresi vengono segnalati nel risultato dello strumento e in `npc_proposals.flags_json`, nella traccia del turno; chi ascolta li registra come credenza dell'oratore. Limite residuo documentato nella spec (§Implementazione): il server non può impedire l'invenzione nel testo.

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (35 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
