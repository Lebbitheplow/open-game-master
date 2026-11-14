# Evoluzione di Open Game Master

## Artifact Graph
- Artifact ID: `artifact:ogm-evolution-wayfinder`
- Role: wayfinder
- Standalone: true
- Children:
  - [01 — Comportamento dei PNG](../tickets/open-game-master-evolution/01-npc-behavior.md)
  - [02 — Proposta tecnica per PNG isolati](../tickets/open-game-master-evolution/02-npc-isolation-design.md)
  - [Ricognizione upstream](../research/ogm-upstream-npc-agents.md)
  - [Studi sugli agenti LLM nei giochi](../research/llm-game-agents-evidence.md)

## Type
Wayfinding spec

## Status
Active — ticket 01 e 02 completati come documenti; nessuna implementazione avviata.

## Destination
Evolvere il fork di Open Game Master, in ordine di priorità:
1. PNG agenti distinti, ciascuno con scheda, personalità, strumenti, memoria e
   conoscenze limitate alle informazioni ricevute dal GM o percepite nel mondo.
   Nessun accesso implicito ai segreti della campagna o aggiornamento retroattivo
   delle conoscenze.
2. Esperienza interamente in italiano.
3. Integrazione con Pi, con ruolo e superficie ancora da definire.

L'isolamento riguarda il contesto e l'accesso ai dati del personaggio, non implica
necessariamente processi o modelli diversi. Questa è un'ipotesi tecnica da valutare,
non una scelta architetturale approvata.

## Decisions So Far
- L'utente ha richiesto clone/fork, isolamento dei PNG, italiano completo e Pi
  a priorità inferiore; ha poi scelto esplicitamente Wayfinder.
- Fork: https://github.com/carlitose/open-game-master
- Checkout: `~/Projects/open-game-master`; origin è il fork, upstream è
  `Lebbitheplow/open-game-master`.
- Base osservata: `ff8635a2bbc6baa7f06388b9aa86bfa2bbb0f16d`.
  È il riferimento dell'indagine, non un vincolo di versione.
- La partita in uso e Kokoro rimangono separati e intatti.
- Lane skills-only, lavoro inline: nessun runner, delegazione o esecuzione
  dei ticket richiesta da «usiamo wayfinder».
- Il colloquio successivo ha confermato il [contratto comportamentale](ogm-npc-behavior.md):
  ispirazioni originali ed evolutive, scheda prevalente, passato coerente, conoscenze
  con provenienza, credenze distinte, rivelazioni motivate, autonomia fuori scena,
  autorità delle regole, campagna nuova e ripresa senza effetti duplicati.
  La spec conserva le risposte esplicite dell'utente; nessuna implementazione è dichiarata.

## Evidence
Riferimenti relativi alla base osservata; ricontrollarli se cambia il codice.
- [Licenza](../../LICENSE): codice MIT; i contenuti di terzi conservano le proprie licenze.
- [Personalità e obiettivi](../../src/lib/dm/npc-logic.ts) e
  [simulazione](../../src/lib/dm/npc-agency.ts): esistono già stati per PNG e
  avanzamenti deterministici fuori scena.
- [Testimoni](../../src/lib/dm/witness-logic.ts): l'assenza è una cautela nel prompt;
  fatti senza testimoni e categorie pubbliche sono trattati permissivamente.
  Questo non dimostra un isolamento stretto.
- [Fatti](../../src/lib/db/facts.ts) e [memoria](../../src/lib/dm/memory-index.ts):
  visibilità, testimoni e ricerca esistono, ma vanno esaminati come un insieme,
  inclusi riassunti, recupero dei ricordi e risultati degli strumenti.
- [Prompt](../../src/lib/dm/prompt.ts): il narratore interpreta i compagni.
- [Agenti esterni](../agent-harness.md): esistono narratore via programmi agentici
  e accesso MCP; non costituiscono già un'integrazione Pi verificata.

## Upstream Reuse
La [ricognizione upstream](../research/ogm-upstream-npc-agents.md) precede il design:
la beta v0.35.0 coincide con la base del clone; nessun sistema pronto di agenti PNG
isolati è emerso. Riutilizzare personalità/coscienza già integrate, valutare la RFC
multi-CLI #495 (respinta, non implementata) senza confonderla con il requisito.
Per l'italiano approfondire il proxy dichiarato nella #919 e il fork francese
prima di progettare da zero. Le dichiarazioni dei contributori non sono test runtime.
Questa evidenza resta un input al design; le decisioni sono confermate dal colloquio
riportato nella [spec comportamentale](ogm-npc-behavior.md), non dalla ricerca.

## Research Findings and User Examples
La [rassegna di studi e progetti](../research/llm-game-agents-evidence.md) distingue
risultati sperimentali, demo e limiti: memoria individuale e struttura della persona
aiutano, ma non eliminano fatti inventati o conoscenza fuori ruolo.
L'utente segnala sconosciuti che conoscono il suo nome, un compagno che introduce
molto tardi lettere scambiate con una vittima e caratterizzazione piatta: includere
questi casi nell'accettazione, senza considerarli già riprodotti o risolti.
Le regole su passato, rivelazioni tardive e deduzioni sono ora confermate nella
[spec comportamentale](ogm-npc-behavior.md).
L'italiano può essere recuperato in seguito, come confermato dall'utente.

## Not Yet Specified
- Contratti tecnici per selezione del contesto, persistenza, consegna degli eventi,
  strumenti per PNG e ripresa dopo un errore: responsabilità del ticket 02.
- Come rendere verificabili i vincoli mentali della scheda e le affermazioni del PNG,
  senza confondere bugie intenzionali, ipotesi e invenzioni del modello.
- Perimetro della traduzione: UI, contenuti, regole, aiuti e nomi propri.
- Ruolo di Pi: narratore, controllo del giocatore, gestione dei PNG o altro.

## Out of Scope
- Implementazione, installazione dipendenze, avvio di una seconda istanza o migrazioni in questa fase.
- Modifica della partita esistente, sostituzione di Kokoro o integrazione TTS privata.
- API a pagamento, estrazione di credenziali, pubblicazione, deploy o merge impliciti.
- Compatibilità retroattiva automatica: va scelta; ogni rischio distruttivo va esplicitato.

## Frontier / Blocking Edges
- Decisioni PNG → ticket 01: risolte nel colloquio; output in
  [ogm-npc-behavior.md](ogm-npc-behavior.md), con provenienza e scenari osservabili.
- Contratto PNG confermato → ticket 02: risolto; [proposta tecnica](ogm-npc-isolation-design.md)
  con prima slice «il nome sconosciuto».
- Proposta tecnica → futura implementazione: creare slice solo dopo la proposta;
  nessun ticket implementativo è autorizzato automaticamente.
- Italiano e Pi restano nella destinazione, ma fuori dalla frontiera immediata:
  aprire indagini dedicate alla revisione successiva, senza predefinirne il design.

## Ticket Plan
| ID | Tipo | Mode | Blockers | Titolo | Output atteso |
| --- | --- | --- | --- | --- | --- |
| 01 | grilling → to-spec | HITL | nessuno | Contratto comportamentale PNG | [Spec confermata](ogm-npc-behavior.md); handoff documentale |
| 02 | research → to-spec | AFK | 01 | Proposta tecnica di isolamento | [Proposta](ogm-npc-isolation-design.md); prima slice definita |

AFK descrive il ticket, non abilita un runner o la sua esecuzione automatica.

## Gates
- Attempt: lavoro sul singolo ticket fino al suo handoff.
- Budget, tempo per attempt, massimo attempts: nessuno impostato.
- Approvazioni: mappa e ticket richiesti; risposte comportamentali di 01 confermate
  come documentato nella spec.
  Nessuna autorizzazione a spendere, migrare dati esistenti, pubblicare, fare deploy o merge.
- Versione esatta: nessuna richiesta.
- Vincoli rilevati: richieste dell'utente, AGENTS.md, CLAUDE.md, README.md,
  docs/configuration.md e documenti sopra; preservare partita e fallback vocale.
  Nessun ulteriore limite operativo rilevato in questi materiali.
- Un gate blocca solo il lavoro dipendente. Eseguire un ticket richiede una richiesta
  di esecuzione; questa mappa non è tale richiesta.

## Next Review
Ticket implementativi creati in [ogm-npc-isolation-design](../tickets/ogm-npc-isolation-design/),
figlia della [proposta](ogm-npc-isolation-design.md). Pronto: 01 «il nome sconosciuto».
Eseguire richiede una richiesta esplicita. Poi indagine sull'italiano.
