# Proposta tecnica: isolamento degli agenti PNG

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-isolation-design`
- Role: spec
- Parent: [Ticket 02](../tickets/open-game-master-evolution/02-npc-isolation-design.md)
- Children:
  - [Il nome sconosciuto](../tickets/ogm-npc-isolation-design/01-nome-sconosciuto.md)
  - [Notizie e assenti](../tickets/ogm-npc-isolation-design/02-notizie-e-assenti.md)
  - [Credenze e bugie](../tickets/ogm-npc-isolation-design/03-credenze-e-bugie.md)
  - [Validazione output](../tickets/ogm-npc-isolation-design/04-validazione-output.md)
  - [Fuori scena](../tickets/ogm-npc-isolation-design/05-fuori-scena.md)
  - [Capacità e ispirazione](../tickets/ogm-npc-isolation-design/06-capacita-e-ispirazione.md)
  - [Compagni del party](../tickets/ogm-npc-isolation-design/07-compagni-del-party.md)

## Type
Architecture spec. Proposta, non implementazione: nessun codice, schema o test eseguito.

## Inputs
- [Contratto comportamentale confermato](ogm-npc-behavior.md), scenari A1–A14.
- [Ricognizione upstream](../research/ogm-upstream-npc-agents.md) e
  [rassegna agenti LLM](../research/llm-game-agents-evidence.md).
- Analisi statica della base `ff8635a2bbc6baa7f06388b9aa86bfa2bbb0f16d`
  (riferimento di evidenza, non vincolo di versione). Checkout invariato salvo `docs/`.

## Current Information Paths (fatti osservati)
| Ingresso | Dove nasce | Isolamento oggi |
| --- | --- | --- |
| Prompt narratore unico | [`turn.ts`](../../src/lib/dm/turn.ts) `openTurn` → `buildDmMessages` ([`prompt.ts`](../../src/lib/dm/prompt.ts)) | Nessuno: un solo contesto interpreta tutti i PNG |
| Storia e riassunti | `getCampaignSummaryState`, capitoli, transcript | Globali alla campagna |
| Fatti del mondo | `listActiveFacts` → `facts` del prompt | `known_by` limita i giocatori, non i PNG |
| Testimoni | [`witness-logic.ts`](../../src/lib/dm/witness-logic.ts), `renderWitnessNote` | Permissivo: fatto senza testimoni = noto a tutti; assenza resa come cautela nel prompt |
| Roster PNG | `npcRosterForPrompt` in [`social-tools.ts`](../../src/lib/dm/social-tools.ts) | Tutti i PNG, con note, nello stesso prompt |
| Lore e regole | [`context-retrieval.ts`](../../src/lib/dm/context-retrieval.ts) | Selezione per rilevanza, non per conoscente |
| Strumenti | catalogo `dmTurnToolCatalogue`, bridge harness ([`bridge.ts`](../../src/lib/harness/bridge.ts)) | Catalogo del GM; letture non filtrate per PNG |
| Stato e scheda | DB campagna, sheet | Il motore è autorevole (da preservare) |
| Persistenza/ritorno | [`turn-journal.ts`](../../src/lib/db/turn-journal.ts), `dm_turns`, retry in [`retry-turn.ts`](../../src/lib/dm/retry-turn.ts) | Revert per turno esistente e robusto; riutilizzabile |

Conclusione: l'informazione segreta raggiunge oggi il modello per costruzione.
Rinforzare il prompt non soddisfa il contratto 01 §4.

## Target Architecture

### 1. Modulo profondo `NpcMind` (confine unico)
Un solo modulo possiede la politica di conoscenza. Interfaccia minima:
- `perceive(event)`: registra un evento percepibile con partecipanti, fonte e tempo di gioco.
- `contextFor(npcId, moment)`: restituisce **solo** il pacchetto autorizzato del PNG.
- `propose(npcId, moment)`: invoca l'agente e restituisce una proposta tipizzata (parole, intenzione, azione richiesta), senza effetti.
- `commit(proposal, ruling)`: applica ricordi e credenze derivati solo dopo l'esito del motore.
Chiamanti (turno GM, fuori scena, retry) non costruiscono mai prompt PNG da soli.

### 2. Dati: tre registri separati
- **Verità** (esistente): `world_facts`, stato, schede. Mai letta direttamente dall'agente.
- **Conoscenza per PNG** (nuova, tabella journaled): `npc_id`, contenuto, `source_event_id`,
  `source_kind` (percepito / detto da X / background / GM-lecito), `learned_at_game_time`,
  `confidence`. Il background iniziale è stabilito a creazione e marcato `background`.
- **Credenze/ipotesi** (nuova o campo dello stesso registro con `kind`): deduzioni, bugie
  credute, sospetti; mai promosse a verità senza un evento del motore.
Le nuove tabelle entrano nel journal dei turni (non classificate come RECORD/OUTSIDE),
così revert e retry restano coerenti senza codice ad hoc.

### 3. Consegna degli eventi
Evento → destinatari calcolati dal server (presenza in scena, raggio di percezione,
destinatario di un messaggio). Senza destinatario esplicito un fatto **non** è noto
(inverso dell'attuale default permissivo, ma solo per campagne nuove: vedi Compatibility).
Notizie tardive sono nuovi eventi con il proprio tempo: A2.

### 4. Contesto dell'agente
`contextFor` compone: scheda e capacità (vincolo 01 §2 espresso come bande descrittive
derivate dalle statistiche), personalità/ispirazione originale, obiettivi, conoscenze
e credenze proprie (recupero limitato al registro del PNG), scena **percepita**
(trascritto filtrato agli enunciati udibili), relazione con chi è presente.
Nome del protagonista incluso solo se presente nel registro: A1.
Nessun accesso al prompt GM, ai fatti globali, ai registri di altri PNG.

### 5. Strumenti consentiti
Catalogo distinto per PNG, solo di lettura sul proprio registro e di proposta:
`recall(query)` sul proprio registro, `propose_action(kind, target, intent)`, `speak(text)`.
Nessuno strumento muta stato; ogni azione passa al motore/GM esistente
(`routeToolCall` resta l'autorità). Qualsiasi lettura cross-PNG è un errore del server.

### 6. Orchestrazione nel turno
Il narratore resta, ma per un PNG coinvolto chiede `NpcMind.propose`; poi narra
il risultato senza riscrivere intenzioni o parole (01 §6). Fuori scena:
`world-tick` esistente invoca `propose` per PNG con obiettivi pertinenti
quando passa tempo di gioco o arriva un evento: A10. Budget di chiamate limitato per tick.

### 7. Fallimenti e ripresa
Proposta salvata come record del turno con stato `proposed | ruled | committed | failed`.
Timeout/azione invalida → `failed`, errore visibile, retry dal punto dopo l'ultimo
effetto `committed`; nessun dialogo sostitutivo, nessun ricordo. Il journal esistente
garantisce l'assenza di duplicati: A12.

### 8. Validazione dell'output (rischio residuo)
Prevenzione dell'accesso: garantita dal server (testabile in modo deterministico).
Invenzione del modello: **non** eliminabile. Mitigazioni: controllo post-generazione
che segnala nomi/eventi propri citati e assenti dal registro (es. nome non appreso,
lettere mai stabilite → A1, A3) e li tratta come affermazione/bugia del PNG, mai come
nuovo fatto; il motore non crea verità dalle parole. Nessuna promessa di infallibilità.

### 9. Due gradi di PNG (decisione dell'utente)
Nomi al tavolo: **Personaggi** (primo grado) e **Comparse** (secondo grado); nel codice
`primary` e `secondary`.

- **Primo grado**: interpretato dalla propria mente, come un giocatore umano. Il narratore
  gli dà il turno con `npc_speak` quando è in scena, dopo i giocatori e prima dell'esito;
  fuori scena solo il primo grado persegue i propri obiettivi. Sono di primo grado tutti i
  compagni di party (`companion_kind = 'party'`), scelti con il numero voluto nella
  creazione dell'avventura. Il dato `npcs.tier = 'primary'` permette anche PNG di primo grado
  non compagni (es. il nemico principale), ma l'interfaccia per marcarli alla creazione
  non esiste ancora: oggi nel gioco reale il primo grado sono i compagni di party.
- **Turno garantito in scena** (applicato dal server): il server non vede chi sta dove,
  quindi "in scena" si eredita di turno in turno. Una mente di primo grado che ha agito
  (detto o fatto qualcosa) nel turno GM precedente è ancora in scena e deve avere il suo
  turno anche in questo. Se il narratore chiude il turno senza `npc_speak` né `npc_inform`
  per lei, il server lo rimanda indietro una volta (`mindsAwaitingTurn` in `npc-mind.ts`,
  nota `sceneMindsPrompt`): `npc_speak` con solo ciò che il personaggio ha potuto vedere e
  sentire da dove si trova, oppure `npc_inform` se ha lasciato la scena. Una notizia non è
  un'azione, quindi dopo `npc_inform` il personaggio esce di scena finché la storia non lo
  interpella di nuovo. Un compagno in combattimento usa il proprio turno di combattimento (§11).
- **Salto di tempo** (applicato dal server): quando il turno fa passare il tempo sulla scena
  (`take_rest`, `pass_time`, `travel`, `downtime`, `TIME_SKIP_TOOLS`), il turno spetta a ogni
  mente di primo grado che era in scena negli ultimi quattro turni GM: in scena se nel più
  recente di quei turni in cui compare ha agito, fuori se lì ha solo ricevuto una notizia
  (`npcsOnStageRecently`). Il narratore le dice quanto tempo passa e cosa succede intorno;
  cosa fa in quel tempo (parla, dorme, veglia, tenta qualcosa) lo sceglie la mente, e il
  narratore racconta il tratto a partire da quella scelta, senza decidere per lei.
- **Secondo grado**: tutti gli altri (oste, fabbro, viandante, alleati `guest`). Li
  interpreta il narratore dalla loro personalità e da un registro leggero: cosa hanno
  appreso, da chi, e quali nomi degli eroi conoscono. `npc_speak` li rifiuta senza
  chiamare il modello; `npc_inform` registra notizie e presentazioni per entrambi i gradi.
- Nessuna promozione o retrocessione per ora: la storia potrà promuovere un PNG in futuro,
  con una decisione separata. Il registro leggero esiste già, quindi un futuro promosso
  porterà con sé solo ciò che ha vissuto.
- Le "stanze" separate sono ricostruite a ogni chiamata dal registro del PNG, non sessioni
  di modello sempre aperte: stesso isolamento, sopravvive a riavvio, revert e retry.

### 10. Compagni lontani dal party (decisione dell'utente)
Un compagno lasciato indietro resta un giocatore: con il party è un giocatore al tavolo,
lontano viene interpellato come farebbe un master con un giocatore umano separato.
- **Separazione**: `move_party` che nomina solo chi va salva per i compagni rimasti il
  luogo e l'istante (`npcs.away_json`, journaled). Chi è lontano non ascolta la scena.
- **Calcolo pigro**: nulla gira mentre nessuno guarda. Quando la storia lo tocca, il server
  esegue un **recupero** del tempo trascorso: un passo ogni mezza giornata, al massimo 6,
  nessuno sotto l'ora. A ogni passo la mente propone dal proprio registro e dal proprio
  luogo, il d20 del motore decide (≥15 riesce, 8–14 in parte, sotto fallisce) e fa avanzare
  l'obiettivo, e la mente ricorda l'esito. Ogni azione è un fatto noto solo al GM.
- **Cosa fa scattare il recupero**: `npc_speak` sul compagno (con `away: true` = cambio di
  scena, resta lontano; senza = ricongiungimento); `npc_inform` a un PNG che sta nel luogo
  del compagno (l'oste a cui si chiede notizie); l'arrivo del party in quel luogo produce
  una nota che chiede al narratore di chiamare il compagno. Il roster ricorda chi è lontano
  e, per i PNG del luogo, chi vi è stato lasciato.
- **Conseguenze**: il recupero precede la scena. Ciò che il compagno ha fatto ad altri
  (ferire, rubare) il server lo consegna al narratore, che lo applica con i propri strumenti
  prima di narrare; chi ha visto sa solo ciò che ha visto.
- **Fallimento**: i passi già giocati restano, nulla viene scritto per il resto, errore
  visibile; il retry riparte dal passo successivo, il revert del turno annulla tutto.
- Limiti: nei combattimenti l'assenza resta dichiarata dal narratore (campo `absent` di
  `start_encounter`), non dedotta da `away_json`. Il recupero costa fino a 6 chiamate.
- Il passaggio fuori scena automatico del timeskip resta per i PNG di primo grado non
  compagni; oggi non ce ne sono in gioco reale.

### 11. Turno di combattimento del compagno (decisione dell'utente: «la mente decide, il narratore esegue»)
- Un compagno di primo grado che nessun giocatore comanda sceglie il proprio turno con la
  propria mente. Nella sua scheda, l'opzione «The GM» diventa «Its own mind»; un giocatore
  può ancora prenderne il comando come oggi.
- La mente conosce tutta sé stessa: la sua scheda come il server la tiene (`describeSheet`:
  punti ferita, CA, caratteristiche, abilità, armi, oggetti, incantesimi e slot, risorse,
  privilegi, condizioni). Del combattimento vede ciò che vedrebbe al tavolo: nemici visibili
  con salute a parole (illeso, ferito, sanguinante, quasi morto) e condizioni, alleati, distanze
  dalla mappa; mai punti ferita o statistiche dei nemici, né nemici nascosti.
- Il server rifiuta le azioni del compagno nel suo turno (attacchi, incantesimi, movimento,
  azioni, oggetti, risorse, `end_turn`) finché la sua mente non ha scelto con `npc_speak`
  in quel turno del narratore. Il narratore esegue l'intenzione con gli strumenti normali;
  se il motore ne rifiuta una parte, richiama `npc_speak` con il motivo e la mente sceglie
  di nuovo. Regole e dadi restano del server.
- Esclusi: compagno comandato da un giocatore, a terra (0 PF), lontano dal party, campagna
  senza menti, Comparse. La rete di sicurezza esistente (`companionAutoAct`) resta.
- Non fatto (opzione 2 scartata): la mente che chiama da sola gli strumenti di combattimento.

### 12. Battute che il narratore scrive per gli altri (decisione dell'utente)
- Le Comparse e chiunque parli senza una mente propria hanno la voce del narratore, che conosce
  tutta la storia. Caso reale: una sentinella che aveva visto arrivare Brakk da solo gli disse
  «puoi tornare dai tuoi» e gli nominò «il problema del carro», rimasto fuori vista.
- Prima di pubblicare la narrazione, il controllo di narrazione (`narration-guard.ts`) fa una
  lettura in più (`voice-knowledge.ts`, modello di utilità) sulle sole battute tra virgolette
  scritte dal narratore: non quelle che una mente ha detto con `npc_speak` in quel turno, né
  quelle dei personaggi giocanti. Il lettore vede la scena recente, chi può parlare (ruolo,
  tratto, luogo, ciò che la sua mente ha imparato) e segnala solo ciò che chi parla afferma o
  dà per scontato senza poterlo sapere; un'ipotesi detta come tale resta.
- Una segnalazione vale solo se cita parole presenti in quelle battute. Il narratore riscrive
  una volta con la riscrittura di riserva che il controllo già usa; se la riscrittura sbaglia
  ancora, la frase viene tagliata come per le altre contraddizioni. Una lettura fallita non
  segnala nulla.
- Attivo solo con il controllo di narrazione e le menti dei PNG accesi: nessuna nuova
  impostazione. Costo: una chiamata di utilità (circa 3-5 s) per turno con battute del narratore.

## Implementazione (branch `npc-agents`)
- Logica pura: `src/lib/dm/npc-mind-logic.ts` (nomi appresi, memorie per PNG e tempo,
  bande, prompt, parsing della proposta, destinatari, nomi non appresi, gradi, roster).
- Registri: `src/lib/db/npc-minds.ts`, tabelle `npc_memories` e `npc_proposals` (journaled),
  colonne `npcs.inspiration` e `npcs.tier`.
- Effetti e strumenti: `src/lib/dm/npc-mind.ts`, `src/lib/dm/npc-mind-tools.ts`
  (`npc_speak`, `npc_inform`, `npc_past`), collegati in `turn.ts`, `invoke-dispatch.ts`,
  `catalog-world.ts`, `tool-profiles.ts`, `prompt.ts`; fuori scena da `world-tick.ts`
  (timeskip, non atteso, al massimo `OFFSCREEN_BUDGET` chiamate per tick).
- `gameSettings.npcMinds` non è un interruttore dell'interfaccia: marca le campagne create
  dopo questa versione (`true` alla creazione), così le esistenti restano invariate (A14).
- Bande mentali (INT ragionamento, SAG percezione e giudizio, CAR presenza):
  ≤5 molto bassa, 6–8 bassa, 9–12 media, 13–16 acuta, ≥17 eccezionale; senza punteggio, media.
  Il PNG riceve la descrizione della banda, mai il numero, e la scheda non viene modificata.
- Limite residuo: il server garantisce che il contesto contenga solo il registro del PNG;
  non può impedire al modello di inventare nel testo. I nomi propri non appresi vengono
  segnalati nella traccia (`npc_proposals.flags_json`) e nel risultato dello strumento,
  e trattati come ipotesi o bugia del PNG; le parole non diventano mai fatti del mondo.
- Test: `scripts/test-npc-mind.mjs` (deterministici, modello finto). La valutazione
  qualitativa con un modello reale resta manuale e non è stata eseguita.

## Compatibility and Migration
Target pulito solo per **campagne nuove** (01). Campagne esistenti invariate: modalità
attuale finché non si decide una migrazione separata, non inclusa. Nuove tabelle additive;
nessuna modifica distruttiva. Nessuna nuova impostazione utente: il nuovo comportamento è
il default della nuova campagna di prova (AGENTS.md: niente toggle senza giustificazione);
se serve un interruttore in fase di sviluppo, va giustificato nella PR.

## Cost and Latency
Una chiamata per PNG coinvolto per battuta più tick fuori scena limitati. Va misurato
(chiamate, token, latenza) prima di estendere; nessuna stima numerica assunta qui.
Con provider locale o harness il costo è tempo, non denaro; nessuna API a pagamento autorizzata.

## Acceptance Scenarios (mappa al contratto)
Copre A1–A14 di [ogm-npc-behavior.md](ogm-npc-behavior.md). Test causali proposti,
**non eseguiti**, con fatti segnaposto:
- Unit (puri, `*-logic.ts`): destinatari di un evento; `contextFor` esclude fatti senza
  fonte, registri altrui, eventi futuri al tempo del PNG; credenza ≠ verità; bande capacità.
- Integration: strumento `recall` che tenta di leggere un altro PNG → rifiuto; riassunto e
  riavvio conservano registri e tempi (A13); retry dopo effetto parziale senza duplicati (A12);
  revert del turno rimuove anche conoscenze derivate.
- System: mini-indagine con PNG assente, messaggero tardivo, testimone bugiardo (A2, A5, A6).
- Manuale/LLM: personalità distinte, A7–A9, in italiano; confronto con narratore unico
  sullo stesso modello. Test generativi separati da quelli deterministici di accesso.

## First End-to-End Slice
"Il nome sconosciuto" (A1 + A12 parziale):
1. Registro conoscenze per PNG (tabella journaled) + `perceive` per presentazioni in scena.
2. `contextFor` minimo (scheda, personalità, registro, scena percepita).
3. `propose` per **un** PNG interlocutore nel turno, con fallimento visibile e retry.
4. Test: sconosciuto senza presentazione non riceve il nome; dopo presentazione sì;
   timeout non crea ricordi. Campagna nuova di prova.
Slice successive: fuori scena, credenze/deduzioni, validazione output, compagni del party.

## Alternatives
- Solo prompt rinforzato e witness note più severe: economico, non isola (rifiutato).
- Filtro dei fatti nel prompt unico del narratore: riduce fughe ma il narratore vede
  ancora tutto e interpreta tutti (rifiutato come target, utile come mitigazione transitoria).
- Agenti PNG persistenti sempre attivi: costo alto, non richiesto (01 §6).

## Open Questions (non bloccanti per la slice 1)
- Granularità percettiva (stanza, distanza, rumore): da decidere nella slice fuori scena.
- Formato delle bande: deciso (vedi Implementazione).
- Promozione dei PNG dal secondo al primo grado durante la storia: rinviata.
Nessuna nuova decisione comportamentale emersa che contraddica il contratto 01.

## Gates
- Attempt: lavoro documentale fino all'handoff; budget, tempo, massimo attempts: nessuno.
- Approvazioni: nessuna spesa, migrazione di campagne esistenti, pubblicazione,
  deploy o merge autorizzati. Implementazione richiede richiesta esplicita.
- Versione esatta: nessuna.
- Vincoli rilevati: AGENTS.md (moduli `*-logic.ts` puri, zod sulle route, nuove tabelle
  classificate nel journal o test `test-turn-journal` fallisce, niente toggle superflui);
  nessun altro blocco trovato in AGENTS.md, CONTRIBUTING richiamato, mappa e ticket.
