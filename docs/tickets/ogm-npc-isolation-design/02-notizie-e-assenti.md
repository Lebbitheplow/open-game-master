---
ticket_schema: 1
ticket_id: "02"
execution_mode: AFK
blocked_by:
  - "01"
---

# Notizie, assenti e messaggi tardivi

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-slice-news`
- Role: ticket
- Parent: [ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md)

## Parent Spec
[ogm-npc-isolation-design.md](../../specs/ogm-npc-isolation-design.md); contratto [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## What to Build
Target Architecture §3: consegna degli eventi ai destinatari calcolati dal server. Senza
destinatario esplicito un fatto non entra nel registro di un PNG (nuove campagne). Messaggi e
notizie sono nuovi eventi con fonte e tempo propri. Granularità minima: presenza nella stessa
scena; percezione per distanza o rumore esclusa. Scenari A2 e A13 di [ogm-npc-behavior.md](../../specs/ogm-npc-behavior.md).

## Acceptance Criteria
- [x] Un PNG assente da un evento non lo conosce finché non riceve un messaggio o una notizia.
- [x] Dopo la consegna conosce il fatto con fonte (chi lo ha detto) e momento della consegna, non dell'evento.
- [x] `renderWitnessNote` non sostituisce più il filtro per le nuove campagne; le vecchie restano permissive.
- [x] Riassunto, salvataggio e riavvio conservano registri e tempi senza contaminazione tra PNG.

## Frontier
Dependency-blocked da 01. Condivide `src/lib/dm/social-tools.ts` e `src/lib/dm/witness-logic.ts`.

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
1. Calcolare i destinatari di un evento dalla scena corrente (logica pura).
2. Modellare messaggio/notizia come evento consegnato a un PNG specifico tramite `perceive`.
3. Collegare la registrazione degli eventi del turno alla consegna.
4. Verificare persistenza dopo compattazione dei riassunti e riavvio.

## Testing Plan
Unit: destinatari e tempi di acquisizione. Integration: assente → messaggero → conoscenza datata;
riavvio del server con registri invariati. Regressione: test-witness, test-turn-journal, typecheck, lint.
Test proposti, non eseguiti.

## Out of Scope
- Percezione per distanza, rumore o stanze adiacenti.
- Attività fuori scena (ticket 05).

## Handoff
`npc_inform` registra notizie e presentazioni con fonte e momento della consegna; chi è presente le sente come credenza della fonte. Nelle nuove campagne il roster mostra il registro di ogni PNG al posto di `renderWitnessNote`; le vecchie restano permissive. Test di persistenza dopo chiusura e riapertura del database.

Branch locale `npc-agents` (base `ff8635a2b`), non committato, non pubblicato. Test: `node scripts/test-npc-mind.mjs` (35 scenari deterministici, modello finto). Verificati anche typecheck, eslint, test di journal, catalogo, profili, sweep e classificazioni. Vitest completo: solo i fallimenti già presenti sulla base. Nessuna prova con un modello reale.
