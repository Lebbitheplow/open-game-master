---
ticket_schema: 1
ticket_id: "07"
execution_mode: AFK
blocked_by:
  - "03"
  - "04"
  - "06"
---

# Compagni del party come agenti isolati

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-companions`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Applicare `NpcMind` ai compagni del party, oggi interpretati dal narratore in `prompt.ts`:
passato stabilito come background, rivelazioni con motivo coerente, nessuna relazione retroattiva.
Scenari A3, A4, A11 e prova di sistema finale della spec.

## Acceptance Criteria
- [x] I compagni parlano e agiscono tramite proposta isolata, e il motore ne valida gli esiti.
- [x] Un compagno senza corrispondenza stabilita non la inventa come fatto; uno con corrispondenza la considera quando pertinente.
- [x] Un'azione contraria alle regole viene rifiutata e il narratore non dichiara il successo.
- [x] La mini-indagine di sistema della spec è eseguibile su una nuova campagna.

## Frontier
Dependency-blocked da 03, 04, 06. Condivide `src/lib/dm/prompt.ts` e `src/lib/dm/turn.ts`.

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
1. Spostare l'interpretazione dei compagni dal prompt del narratore a `NpcMind`.
2. Caricare il background iniziale come conoscenze `background`.
3. Eseguire la prova di sistema e registrarne gli esiti.

## Testing Plan
Integration: A3, A4, A11. System: mini-indagine con PNG assente, messaggero e testimone bugiardo.
Manuale: personalità distinte in italiano. Regressione: test-npc-agency, test-enforce-npc-reactions, typecheck, lint.
Test proposti, non eseguiti.

## Out of Scope
- Migrazione della partita esistente.
- Traduzione e integrazione Pi.

## Handoff
I compagni di party sono di primo grado: proposta isolata, conoscono il proprio party, sono vincolati dalle bande della scheda. Corrispondenza non stabilita: segnalata e mai fatto; quella stabilita con `npc_past` entra nel contesto. Le intenzioni sono solo tentativi: nessuno stato cambia per le parole della mente, e l'esito resta agli strumenti del motore (il rifiuto è quello già esistente, non testato end-to-end con un modello reale). La mini-indagine di sistema è eseguita in modo deterministico, con riavvio.

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (35 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
