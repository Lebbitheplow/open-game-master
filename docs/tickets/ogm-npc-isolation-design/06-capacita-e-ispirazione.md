---
ticket_schema: 1
ticket_id: "06"
execution_mode: AFK
blocked_by:
  - "01"
---

# Capacità dalla scheda e ispirazione originale

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-abilities`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Target Architecture §4 e contratto §1–§2: bande descrittive derivate dalle statistiche mentali
nel contesto dell'agente; ispirazione come tratti, non lore importata; evoluzione dopo esperienze
vissute. Scenari A7, A8, A9.

## Acceptance Criteria
- [x] Un PNG con Intelligenza 3 riceve vincoli coerenti e le statistiche non vengono alzate.
- [x] L'ispirazione non introduce nomi, poteri o relazioni dell'opera originale nel registro.
- [x] Un'esperienza vissuta (es. tradimento) aggiorna atteggiamento in modo tracciabile.
- [x] Il formato delle bande è documentato e coperto da test.

## Frontier
Dependency-blocked da 01. Domanda aperta della spec (formato delle bande) decisa qui come scelta tecnica, da riportare.

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
1. Derivare bande da INT/SAG/CAR in logica pura.
2. Inserirle in `contextFor` insieme a personalità e ispirazione.
3. Aggiornare l'atteggiamento con eventi vissuti tramite strumenti esistenti di relazione.

## Testing Plan
Unit: bande per valori limite. Manuale/LLM: confronti A7–A9 in italiano sullo stesso modello; nessuna API a pagamento.
Regressione: test-npc-personality-repair, typecheck, lint.
Test proposti, non eseguiti.

## Out of Scope
- Nuove regole numeriche o successi automatici.

## Handoff
Bande mentali documentate nella spec e testate; la scheda non viene modificata. L'ispirazione è solo maniera (`npc_past`, chiusa dopo il primo atto). Il tradimento vissuto si legge da standing e memoria della relazione (test).

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (35 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
