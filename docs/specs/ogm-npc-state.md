# Scheda di stato dei personaggi non giocanti

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-state`
- Role: spec
- Standalone: true
- Children:
  - [01 — Prigioniero e condizione](../tickets/ogm-npc-state/01-prigioniero-e-condizione.md)
  - [02 — Chi viaggia col gruppo](../tickets/ogm-npc-state/02-chi-viaggia-col-gruppo.md)
  - [03 — Nome scoperto](../tickets/ogm-npc-state/03-nome-scoperto.md)
  - [04 — Cosa porta addosso](../tickets/ogm-npc-state/04-cosa-porta-addosso.md)
  - [05 — Le menti vedono chi hanno davanti](../tickets/ogm-npc-state/05-le-menti-vedono-chi-hanno-davanti.md)
  - [06 — Narrazione coerente con la scheda](../tickets/ogm-npc-state/06-narrazione-coerente-con-la-scheda.md)

## Type
Feature spec.

## Goal
Il server tiene, per ogni personaggio non giocante tracciato, uno stato fisico
preciso: dove si trova, in che condizione è, chi lo tiene prigioniero, cosa porta
di rilevante e con quale nome è conosciuto. Il Master lo riceve a ogni turno e non
deve più ricordarselo dalla prosa.

## Non-goals
- Nessuna simulazione dell'inventario completo dei PNG né dei loro punti ferita
  fuori dal combattimento.
- Nessuna modifica a ciò che un PNG *sa*: memorie, udito e livelli restano come sono.
- Nessuna interfaccia nuova per il giocatore nella prima versione.
- Nessun contributo upstream: lavoro sul fork.

## Current Behavior and Evidence
Osservato nella campagna di prova `9ad92a45-…` il 2026-11-15, tabella `npcs`:

| Personaggio | Registro | Finzione |
|---|---|---|
| Uomo armato del mulino | `location`: Vecchio mulino | si chiama Rugo, legato, prigioniero in piazza, parte col carro |
| Aldren | `location` vuoto | prigioniero in catene con Mara |

- Lo stato fisico di un PNG oggi è il solo campo `location`, testo libero, scritto
  dal Master con `set_npc` ([social-tools.ts](../../src/lib/dm/social-tools.ts)) quando se ne ricorda.
- L'elenco che il Master riceve ([prompt.ts](../../src/lib/dm/prompt.ts), «Tracked NPCs»)
  mette in cima chi ha `location` uguale al luogo corrente
  ([npc-rank-logic.ts](../../src/lib/dm/npc-rank-logic.ts)): un prigioniero con il luogo
  sbagliato scivola in fondo o fuori dall'elenco. È il motivo per cui Rugo è stato
  dimenticato per un'intera notte di gioco.
- Rinominare un PNG conservando il vecchio nome come alias esiste (`renameNpc` in
  [npcs.ts](../../src/lib/db/npcs.ts)) ma solo dalla revisione manuale, non dal Master.
- Non esiste alcun campo per prigionia, legami, incoscienza o oggetti portati.

## Target Behavior

### Scheda
Ogni PNG tracciato ha, oltre a ciò che esiste già:

| Voce | Valori | Default |
|---|---|---|
| Luogo | luogo noto del mondo | invariato |
| Con il gruppo | sì / no | no |
| Custodia | libero; prigioniero di *chi* | libero |
| Vincoli | nessuno; legato; in catene; rinchiuso | nessuno |
| Condizione | in piedi; ferito; svenuto; morto | in piedi |
| Porta | breve elenco di oggetti rilevanti; disarmato sì/no | vuoto |
| Nome | nome con cui è tracciato, con i precedenti come alias | invariato |

### Regole del server
1. **Il Master dichiara, il server registra.** Un solo strumento del Master,
   `npc_state`, cambia custodia, vincoli, condizione e «con il gruppo». I valori sono
   elenchi chiusi; un valore sconosciuto è rifiutato con l'elenco di quelli ammessi.
2. **Chi è con il gruppo segue il gruppo.** Quando il luogo corrente del gruppo
   cambia, il luogo di ogni PNG «con il gruppo» cambia nello stesso momento, senza
   che il Master faccia nulla. Un prigioniero del gruppo o di un PNG che è con il
   gruppo è «con il gruppo» finché resta prigioniero.
3. **Chi agisce in scena è in scena.** Un PNG che parla con `npc_speak` o che viene
   catturato viene spostato nel luogo corrente se il registro diceva altrove.
   **Chi è in scena sente tutto.** Le battute dette ad alta voce nel turno (eroi,
   narratore, menti) vengono ricordate da ogni PNG di primo livello con il gruppo o
   nel luogo corrente, sveglio e non lontano. Niente tiri di Percezione: le notizie
   da lontano passano da `npc_inform`.
4. **Coerenza interna.** Un morto non parla né agisce; uno svenuto non parla e non
   sente; liberare un prigioniero toglie custodia e vincoli insieme. Le chiamate che
   violano queste regole sono rifiutate con una frase che dice cosa correggere.
5. **Nome scoperto.** Il Master può dare a un PNG il nome appena rivelato: il
   vecchio resta come alias, memorie, relazioni e livello restano attaccati alla
   stessa persona.
6. **Oggetti.** Il Master può segnare cosa un PNG porta di rilevante e se è stato
   disarmato. Sono note per la coerenza, non un inventario con regole.

### Cosa vede chi
- **Master:** nella riga di ogni PNG dell'elenco, dopo l'atteggiamento, lo stato
  che non è al default («prigioniero di Mara, in catene, con il gruppo»). I
  prigionieri e chi è con il gruppo stanno sempre nella parte alta dell'elenco.
- **Menti di primo livello:** per ogni altro personaggio presente, solo ciò che si
  vede guardandolo: vincoli, condizione, custodia evidente, armi tolte. Mai lo
  stato di chi è altrove, mai gli oggetti nascosti.
- **Giocatore:** niente di nuovo. La scheda non è mostrata e non rivela livelli.

### Guardia sulla narrazione
Dopo la risposta del Master, se in scena ci sono PNG con stato non al default, un
controllo confronta la prosa con la scheda. Una contraddizione chiara (un legato
che impugna un'arma, un prigioniero lasciato indietro senza che nessuno lo
dichiari, uno svenuto che risponde) rimanda il Master a correggersi una sola volta,
come già avviene per le altre guardie ([turn.ts](../../src/lib/dm/turn.ts)). Dopo il
secondo tentativo la risposta passa comunque: la guardia non blocca mai il gioco.

## Semantic Invariants
- Il server resta l'autorità: la prosa non cambia la scheda, solo lo strumento.
- La scheda non dà a nessuna mente una conoscenza che non avrebbe guardando.
- Nessuna diagnostica o messaggio al giocatore elenca PNG, livelli o conteggi.
- Una campagna esistente continua a funzionare: ogni voce nuova ha un default.

## Data
- Nuove colonne sulla tabella `npcs`, tutte con default; migrazione additiva,
  nessun dato cancellato o riscritto.
- La campagna di prova viene allineata a mano una volta (Rugo, Aldren) dopo il
  ticket 03, con copia del database prima della modifica.

## Failure Modes
- Il Master non chiama `npc_state` alla cattura: coperto dalla guardia (ticket 06)
  e dalla regola 3.
- La guardia sbaglia e rimanda indietro una prosa corretta: costa un tentativo in
  più, mai un blocco.
- Il modello di utilità non risponde: la guardia tace, la risposta passa.

## Alternatives Considered
- **Fatti del mondo con chiave** («prigioniero: Rugo»): già possibili oggi, ma sono
  testo libero che il Master deve scrivere e rileggere; è il comportamento che ha fallito.
- **Estendere `set_npc`:** scartato perché quello strumento registra chi è una
  persona; lo stato cambia molte volte per scena e ha regole proprie.
- **Dedurre lo stato dalla prosa a ogni turno:** scartato come fonte primaria,
  perché rende la prosa l'autorità; resta solo come guardia.

## Implementation Slices
1. Custodia, vincoli e condizione: colonne, `npc_state`, riga nell'elenco del Master.
2. «Con il gruppo» e luogo che segue; regola 3.
3. Nome scoperto dal Master.
4. Oggetti portati e disarmo.
5. Vista delle menti di primo livello.
6. Guardia sulla narrazione.

## Verification Strategy
- **Unit, senza modello:** regole di coerenza, rifiuti, luogo che segue, rinomina
  che conserva le memorie; nuovi casi in `scripts/test-npc-state.mjs` e in
  `scripts/test-npc-mind.mjs` per la vista delle menti.
- **Con modello vero, su copia del database:** rigiocare la cattura al mulino e la
  partenza per Roccanera; il Master deve registrare il prigioniero e ricordarlo
  dopo il riposo lungo.
- **Controlli di progetto:** `npx tsc --noEmit`, `npm run lint`, test NPC esistenti.

## Assumptions
- «Morto» sulla scheda non sostituisce i fatti del mondo già usati per le morti:
  li affianca, e la regola 4 legge la scheda.
- La campagna è di prova («Questa campagna è di prova, quindi devi provare, fixare
  e migliorare», utente, 2026-11-15): le modifiche alle regole di gioco sono di
  nuovo ammesse.

## Gates
- Attempt: il lavoro di ogni ticket fino alla consegna.
- Budget, tempo, numero massimo di tentativi: nessuno fissato.
- Approvals: modifiche locali e test non ne richiedono. Merge sul `main` del fork
  e riavvio del server della partita: coperti dalla frase dell'utente citata sopra,
  con il vincolo già in vigore di riavviare solo senza turni attivi e di non
  lavorare mai nel checkout della partita.
- Exact version: nessuna.
- Existing blocks: nessuno trovato. Cercato in `.github/CONTRIBUTING.md`, in
  `scripts/name-lookups.json` (classificazione obbligatoria dei file nuovi sotto
  `src/lib`) e nelle memorie di sessione (`ogm-stability-freeze`, superata dalla
  frase citata; `ogm-no-spoiler-counts`, rispettata dagli invarianti).
