# Ricognizione upstream: agenti PNG, conoscenza e traduzioni

## Artifact Graph
- Artifact ID: `artifact:ogm-upstream-npc-agents`
- Role: research
- Parent: [Mappa Wayfinder](../specs/open-game-master-evolution-wayfinder.md)

## Question
Esiste già nelle beta, nei branch, nelle PR, nelle issue o nei fork citati da
Open Game Master un'implementazione o una proposta riutilizzabile per agenti PNG
con conoscenze isolate, italiano completo e integrazione Pi?

## Answer
Non è emersa una versione pronta con un agente e un contesto strettamente isolato
per ciascun PNG. Esistono componenti utili già integrati e una proposta multi-agente
respinta, diversa dal requisito. Per l'italiano esiste invece una testimonianza
concreta da approfondire prima di costruire una nuova traduzione.

## Snapshot e copertura
- GitHub API: otto release più recenti, 24 branch, tutte le tre PR aperte,
  ricerche tra issue/PR aperte e chiuse, e l'unica Discussion pubblica.
- Ricerca NPC: 134 risultati, entrambe le pagine esaminate per titolo; lettura
  approfondita dei risultati pertinenti. Query aggiuntive: knowledge, witness,
  memory, multi-agent, NPC agent, separate + NPC, omniscient, Italian, pi.
- Ricerche globali GitHub come controllo aggiuntivo, non censimento dei fork.
- Nessuna wiki compatibile individuata nella ricerca locale iniziale a profondità 4:
  fonti primarie consultate direttamente.
- Nessun codice applicativo modificato, installazione, test runtime o consumo LLM.
  I risultati sono statici e dipendono dallo snapshot pubblico osservato.

## Evidence

### Beta: siamo già sulla più recente osservata
[Beta v0.35.0](https://github.com/Lebbitheplow/open-game-master/releases/tag/v0.35.0),
pubblicata il 13 novembre 2026: stesso commit di main e del clone,
`ff8635a2bbc6baa7f06388b9aa86bfa2bbb0f16d`.
Le note trattano combattimento, narratore, equipaggiamento e correzioni; non
annunciano agenti PNG separati. Il branch dev è dietro main di 2069 commit,
non è una versione più avanzata. Stable punta alla v0.34.3.

Le PR aperte osservate erano #948 (immagini inutilizzate), #949 (viaggio a bordo)
e #950 (regole): nessuna propone il sistema richiesto.

### Multi-agente: proposta presente, non implementata né accettata
[PR #495](https://github.com/Lebbitheplow/open-game-master/pull/495):
RFC documentale per un narratore principale e un consulente CLI con contesto
limitato, senza strumenti MCP. Chiusa senza merge.
Il maintainer dichiara di non voler adottare il coordinamento multi-CLI,
preferendo un narratore per tavolo e meno chiamate/impostazioni.
Non è una proposta di memoria privata persistente per ogni PNG.
Questa scelta segnala un possibile disallineamento con upstream; non prova che
una diversa proposta sui PNG sarebbe automaticamente respinta.

### Personalità e autonomia: molto esiste già
[Issue #503](https://github.com/Lebbitheplow/open-game-master/issues/503),
[PR #507](https://github.com/Lebbitheplow/open-game-master/pull/507), merged,
e [PR #564](https://github.com/Lebbitheplow/open-game-master/pull/564), merged:
valori, azioni con testimoni, coscienza, abbandoni, tradimenti, obiettivi fuori
scena e ritorni dei compagni. Le decisioni meccaniche sono governate dal server;
non equivalgono ad agenti LLM individuali isolati.

[Il codice dei testimoni](../../src/lib/dm/witness-logic.ts) spiega esplicitamente
che l'assenza di un testimone non dimostra ignoranza e rende l'assenza una cautela
del prompt, non un divieto. I fatti senza testimoni sono trattati come ambientali.
[Il prompt](../../src/lib/dm/prompt.ts) affida al narratore i dialoghi dei compagni.
Questi due ancoraggi distinguono le funzionalità esistenti dal requisito.

### Italiano: una soluzione è dichiarata già in uso
[Commento di ziomik alla #919](https://github.com/Lebbitheplow/open-game-master/issues/919#issuecomment-6860780739):
proxy davanti alla build invariata, script che sostituisce testi e attributi
visibili, catalogo inglese→italiano di circa 45.800 voci, glossario 5e e
aggiornamento incrementale. L'autore dichiara uso in campagna sulla v0.34.3.
Sono affermazioni dell'autore: codice del proxy, catalogo e copertura non sono
stati reperiti/verificati attraverso quel commento. Non è una release ufficiale.
La tecnica non traduce automaticamente ogni possibile testo dinamico.

### Francese: fork reale, con un meccanismo riutilizzabile da valutare
[Issue #919](https://github.com/Lebbitheplow/open-game-master/issues/919), aperta:
[fork bkruggel, branch i18n-french](https://github.com/bkruggel/open-game-master/tree/i18n-french).
Branch verificato al commit `47045607f3d1e6e746f6a568182115dd5471f18a`;
l'albero contiene locale.ts, request-locale.ts e messages/fr.ts.
L'autore dichiara ampia copertura UI e contenuti, ma non abbiamo eseguito il fork.

Il maintainer accoglie la traduzione ma chiede prima contenuti/glossari, poi
un'interfaccia con testo inglese come chiave, estrazione e bozze automatiche,
non l'attuale dizionario a chiavi simboliche. Un altro contributore evidenzia
limiti di localStorage/header per SSR, EventSource e richieste non-fetch.
Sono indicazioni progettuali discusse, non garanzie di implementazione upstream.

### Pi
Nessun risultato nella ricerca testuale pi sulle issue/PR upstream.
[Il supporto agenti](../agent-harness.md) offre già narratore via programmi CLI
e collegamento MCP. Non è prova di un adattatore Pi pronto.

## Unknowns
Non è un audit di ogni commit di ogni fork o di canali privati/Discord.
Le ricerche GitHub possono perdere sinonimi o idee non indicizzate.
Non sono verificati runtime dei fork, catalogo italiano o compatibilità col clone.
La scelta futura del maintainer su agenti PNG distinti resta sconosciuta.

## Next Step
- Non cambiare beta per cercare il sistema: quella osservata coincide col clone.
- Conservare schede, personalità, coscienza e motore delle regole esistenti;
  concentrare l'eventuale nuovo lavoro sul confine informativo e l'esecuzione PNG.
- Prima di progettare la traduzione, approfondire disponibilità/licenza del catalogo
  italiano e il meccanismo francese. Nessun contatto pubblico è stato effettuato.
- Le decisioni del ticket 01 restano aperte; la ricerca non vale come risposta umana.
