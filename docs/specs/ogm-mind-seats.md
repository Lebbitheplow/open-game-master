# Posti mente: persone e agenti che giocano un NPC via MCP

## Problema
Oggi via MCP un agente gioca solo il proprio personaggio. Le menti dei personaggi chiave
(compagni e NPC di primo livello, vedi `ogm-npc-behavior.md`) le fa pensare sempre il modello
del server. Il proprietario vuole che altre persone, con il loro agente (Pi, Claude…),
possano interpretare un NPC, senza che lui scopra chi sia o che cosa sappia.

## Decisioni
- **Posto mente**: il capo del gruppo crea un posto e ottiene un codice da condividere.
  Il posto non nomina nessun personaggio: chi lo crea non scopre nulla.
- Chi riceve il codice, con un account sul server, lo rivendica via MCP. Non diventa membro
  della campagna e non legge la cronaca: riceve solo le richieste della propria mente.
- **Assegnazione automatica**: la prima volta che serve la mente di un personaggio di primo
  livello senza posto, il server gli assegna il posto rivendicato libero più vecchio. Lo
  sceglie il server e non chi gioca, così non trapela niente della trama.
- **Stessa isolazione**: chi occupa il posto riceve lo stesso prompt isolato della mente
  interna (passato, ciò che percepisce, ciò che gli hanno detto). Risponde con
  `speech`, `intent`, `conclusion` e `lie`, che seguono la stessa validazione
  (`parseProposal` e i controlli sui nomi non appresi). Regole e dadi restano al server.
- **Anche in combattimento**: il turno di un compagno passa dalla stessa mente, quindi chi
  occupa il posto sceglie anche le sue mosse in battaglia.
- **Nessun blocco**: se la risposta non arriva entro `MIND_SEAT_TIMEOUT_SEC` (90 s per
  default), per quella battuta risponde il modello del server. Le vite fuori scena, che
  avanzano tra un turno e l'altro, restano sempre al modello del server.
- **Il Master riprende il personaggio**: il capo del gruppo può liberare un posto; da quel
  momento il personaggio torna alla mente del server.
- Le connessioni MCP limitate a una sola campagna non possono occupare posti mente.

## Interfaccia
- Capo del gruppo: `odm_mind_seat_create`, `odm_mind_seats` (stato del posto e nome
  utente di chi lo occupa, mai il personaggio), `odm_mind_seat_release`.
- Occupante: `odm_mind_seat_claim` (codice), `odm_mind_wait` (attende fino a 25 s
  le richieste pendenti), `odm_mind_answer`.
- Tabella `mind_seats`: impostazioni del tavolo, fuori dal giornale dei turni (un turno
  annullato non toglie un posto).

## Fuori ambito
Interfaccia web per i posti, posti per NPC di secondo livello, scelta del personaggio da
parte di chi occupa il posto.
