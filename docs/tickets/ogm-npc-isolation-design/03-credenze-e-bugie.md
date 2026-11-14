---
ticket_schema: 1
ticket_id: "03"
execution_mode: AFK
blocked_by:
  - "01"
---

# Credenze, bugie e deduzioni separate dalla verità

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-beliefs`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Target Architecture §2 (registro credenze/ipotesi) e contratto §3: deduzioni, sospetti e
bugie credute restano credenze del PNG; una menzogna detta non diventa ricordo autentico del
suo autore; nulla viene promosso a verità senza evento del motore. Scenari A5 e A6.

## Acceptance Criteria
- [x] Un PNG che crede a un testimone bugiardo registra una credenza con fonte, mentre la verità resta invariata.
- [x] Una deduzione del PNG è salvata come ipotesi e non entra nei fatti del mondo.
- [x] Un PNG che mente non registra la propria bugia come fatto vissuto.
- [x] Il contesto distingue all'agente ciò che sa da ciò che crede o sospetta.

## Frontier
Dependency-blocked da 01. Condivide il modulo `NpcMind` e la sua logica pura.

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
1. Estendere il registro con `kind` (conoscenza/credenza/ipotesi) e confidenza.
2. In `commit`, classificare le affermazioni ricevute come credenze secondo la fonte.
3. Rendere distinguibili le sezioni nel contesto dell'agente.

## Testing Plan
Unit: classificazione e nessuna scrittura su `world_facts`. Integration: testimone bugiardo e deduzione errata
in un turno. Regressione: typecheck, lint, test-turn-journal.
Test proposti, non eseguiti.

## Out of Scope
- Validazione automatica delle invenzioni (ticket 04).

## Handoff
Credenze (`belief`, con fonte), ipotesi (`hypothesis`), bugie (`lie`) e fatti vissuti (`knowledge`) restano distinti nel registro e nel prompt; nessuna parola diventa fatto del mondo. Test: testimone bugiardo, deduzione e bugia consapevole.

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (35 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
