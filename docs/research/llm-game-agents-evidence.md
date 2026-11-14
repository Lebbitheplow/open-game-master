# Agenti LLM nei giochi: risultati, limiti e lezioni per i PNG

## Artifact Graph
- Artifact ID: `artifact:ogm-llm-game-agents-evidence`
- Role: research
- Parent: [Mappa Wayfinder](../specs/open-game-master-evolution-wayfinder.md)

## Question
Quali risultati hanno ottenuto progetti e studi che assegnano a LLM ruoli,
personalità e memoria nei giochi, e cosa è trasferibile ai PNG di Open Game Master?

## Answer
Esistono risultati convincenti su comportamento sociale emergente, dialoghi e
azioni nel mondo. Non dimostrano però che basti assegnare una personalità a un LLM
per ottenere personaggi coerenti per un'intera campagna. Ricordi inventati,
conoscenza fuori ruolo, recupero mancato e voce uniforme sono problemi documentati.
La direzione promettente è un sistema ibrido: stato e accessi governati dal server,
memoria individuale, generazione espressiva limitata a ciò che il PNG può sapere.
Questa è una sintesi progettuale da verificare, non un'architettura già approvata.

## Scope and Evidence Quality
Lettura di fonti primarie: articoli arXiv e sezioni di risultati/limiti, repository
e sito ufficiale di Mantella. Rassegna mirata, non systematic review esaustiva.
La ricerca web ha restituito anche query vuote; sono stati usati ricerca arXiv e
accesso diretto agli articoli. Un identificativo provato, 2308.16652, si è rivelato
non pertinente ed è stato escluso. Nessun esperimento riprodotto in locale.
Non è emersa una wiki locale compatibile nella ricognizione precedente;
qui si usano fonti primarie direttamente. Numeri sotto riportati dagli autori,
non misurati su Open Game Master né sui suoi modelli attuali.

## 1. Generative Agents / Smallville — 2023
Fonte: [paper v2](https://arxiv.org/html/2304.03442v2), sezioni 4, 6, 7 e 8.2.
Codice: [generative_agents](https://github.com/joonspk-research/generative_agents).

- Sandbox ispirato a The Sims con 25 agenti. Ogni agente ha osservazioni, memoria,
  recupero per rilevanza/recenza/importanza, riflessioni e piani.
- Valutazione controllata: 100 valutatori umani classificano cinque condizioni
  per credibilità. Architettura completa: TrueSkill 29,89; senza riflessione
  26,88; senza riflessione/pianificazione 25,64; senza memoria/piani/riflessione
  21,21. Sono punteggi di ranking, non percentuali di correttezza.
- Simulazione end-to-end di due giorni di gioco: la notizia della festa passa da
  1 a 13 agenti; 5 dei 12 invitati partecipano. Quattro assenti avevano espresso
  interesse ma non pianificano di andarci, tre citano altri impegni.
- Su 453 risposte sulla conoscenza di altri agenti, 6 (1,3%) risultano inventate.
  Questo dato riguarda quel controllo ristretto, non ogni affermazione del gioco.
- Errori qualitativi: ricordi recuperati male, dettagli aggiunti senza base e
  linguaggio troppo formale. Un agente inventa un annuncio elettorale per il giorno
  dopo, pur sapendo realmente solo della candidatura.
- Limiti: simulazione breve; nel setup del 2023 furono necessari più giorni reali
  e migliaia di dollari in token. Non è una stima di costo per il nostro progetto.
  Gli autori segnalano anche memory hacking e robustezza ancora poco conosciuta.

**Lezione:** l'architettura aiuta, ma una memoria testuale non rende vere tutte le
frasi prodotte. Le riflessioni non devono essere promosse automaticamente a fatti.

## 2. Mantella — Skyrim e Fallout 4
Fonti: [repository](https://github.com/art-from-the-machine/Mantella) e
[documentazione del progetto](https://art-from-the-machine.github.io/Mantella/).

Mod concreto, non soltanto un paper: collega gioco, riconoscimento vocale, LLM e
sintesi vocale. Il progetto descrive background individuali per oltre 3.000 PNG,
memoria delle conversazioni, eventi di gioco, conversazioni tra PNG e azioni come
seguire, commerciare e attaccare. Repository e distribuzione esistono.

**Risultato sostenibile:** l'integrazione di personaggi conversazionali in un
videogioco esistente è praticabile. Le caratteristiche pubblicizzate non sono
una valutazione indipendente dell'assenza di ricordi falsi o spoiler. Non abbiamo
eseguito il mod né verificato il suo isolamento informativo. L'accesso alla visione
del giocatore, dichiarato dal progetto, non equivale alla percezione lecita di ogni PNG.

**Lezione:** studiare l'adattatore gioco-dialogo e il ciclo di memoria; non assumere
che il sistema di conoscenza soddisfi il requisito di Open Game Master.

## 3. Project Sid / PIANO — 2024
Fonte: [paper v1](https://arxiv.org/html/2411.00114v1), sezioni 3–8.
Repository: [project-sid](https://github.com/altera-al/project-sid).

- Agenti in Minecraft con moduli per cognizione, memoria, comportamento sociale
  e azione; simulazioni di specializzazione, regole collettive e trasmissione culturale.
- La prova individuale riporta in media 17 oggetti distinti dopo 30 minuti con
  l'architettura completa, con variabilità legata anche al punto di comparsa.
- Il dettaglio conta: benché siano stati avviati oltre 1.000 agenti, gli autori
  dichiarano problemi di risorse e agenti intermittentemente non responsivi.
  L'analisi culturale della sezione 5.3 usa una sola simulazione da 500 agenti.
- La specializzazione è studiata con 30 agenti; i ruoli sono inferiti dai loro
  obiettivi tramite GPT-4o. Non si tratta soltanto di giudizi umani indipendenti.
- Limiti dichiarati: visione e ragionamento spaziale, coordinamento pratico e
  spinte autonome deboli. Le strutture sociali risentono delle conoscenze già
  presenti nei modelli; non sono civiltà nate davvero da zero.

**Lezione:** il comportamento sociale emergente è possibile, ma non occorre
simulare centinaia di agenti continuamente per ottenere tre compagni credibili.
Scalabilità, latenza e qualità narrativa sono dimensioni diverse.

## 4. CALYPSO — assistente del Dungeon Master, 2023
Fonte: [paper](https://arxiv.org/html/2308.07540), sezioni 3 e 6.

- Interviste formative a sette DM, poi uso del sistema nel gioco; strumenti per
  comprendere incontri, descrivere scene e fare brainstorming.
- I DM riferiscono testi utilizzabili e idee da sviluppare mantenendo la propria
  autorità creativa. Sono risultati qualitativi di assistenza, non prova di un GM
  autonomo o di un agente privato per ciascun PNG.
- Errori riportati: ragni con telepatia, creature con abilità o ali non previste;
  in alcuni casi il modello inventa persino il risultato di un comando per i dadi.
- Piccole invenzioni descrittive possono essere utili quando il DM le seleziona;
  inventare regole o fatti rilevanti non è la stessa cosa.

**Lezione:** preservare il motore di regole di Open Game Master; separare colore
narrativo e modifiche ai fatti, alle schede e agli esiti delle azioni.

## 5. RoleKE-Bench — errori di conoscenza del personaggio, 2024/2025
Fonte: [paper v2](https://arxiv.org/html/2409.11726v2), sezioni 4–6.

- Benchmark di 990 query, 495 per categoria: errori su ciò che il personaggio
  conosce e affermazioni fuori dalla sua conoscenza. Non è una campagna giocata.
- Valuta 21 LLM. Gli autori riportano che l'accuratezza massima delle valutazioni
  di base non supera il 65%; non significa che il 35% dei dialoghi in un gioco
  qualsiasi sarebbe falso.
- Dataset costruito con GPT-4o e verifiche umane; giudice principale DeepSeek-v2,
  con controllo umano del protocollo e tre ripetizioni per le valutazioni.
- Self-Recollection and Self-Doubt migliora il rilevamento tramite richiamo e
  verifica dei confini di conoscenza, ma non elimina il problema.

**Lezione:** chiedere allo stesso LLM di controllarsi può aiutare, ma non sostituisce
filtri deterministici su quali dati può leggere. Il sapere preaddestrato del modello
non deve diventare automaticamente il sapere del personaggio.

## 6. Memory-Driven Role-Playing / MRPrompt — 2026
Fonte: [paper v1](https://arxiv.org/html/2603.19313v1), sezioni 3–4,
Tabella 2 e Limitations.

- Distingue ancoraggio alla persona, selezione dei ricordi, confini temporali e
  informativi, espressione naturale. La personalità è organizzata in aspetti
  richiamabili dalla situazione, non solo un elenco piatto di aggettivi.
- Metodo solo prompt, senza training né strumenti di recupero esterni.
- MRBench: 200 esempi inglesi e 200 cinesi per famiglia di capacità; 12 modelli.
  Punteggi del giudice GPT-4.1-mini calibrati su valutazioni umane, scala 1–10.
- Esempi dalla Tabella 2: Qwen3-8B passa da 7,95 (Base) a 8,12 (MRPrompt);
  Llama-3.2-3B da 7,11 a 7,61. Medie su otto metriche e due lingue,
  non percentuali di successo né confronti diretti con Open Game Master.
- Limite decisivo: ogni prova genera una sola risposta con memoria fornita e
  fissa. Non verifica aggiornamento della memoria durante campagne lunghe,
  coordinamento di più personaggi o qualità in italiano.

**Lezione:** è una buona struttura per valutare separatamente voce, richiamo e
onniscienza; è una tecnica candidata, non una soluzione già validata al nostro caso.

## 7. Voyager — azioni e abilità in Minecraft, 2023
Fonte: [paper v2](https://arxiv.org/abs/2305.16291v2).

Curriculum automatico, libreria crescente di abilità eseguibili e feedback dal
mondo. Gli autori riportano 3,3 volte gli oggetti unici, 2,3 volte la distanza e
traguardi fino a 15,3 volte più rapidi dei confronti dello studio.
Qui è stato verificato l'abstract, non l'intero protocollo sperimentale.
Non è un risultato sulla qualità della personalità o sul rispetto dei segreti.

**Lezione:** azioni verificabili e feedback del motore sono più affidabili della
sola narrazione di un successo. Il codice eseguibile generato non è necessario
né raccomandato automaticamente per i nostri PNG.

## Implications for Open Game Master — proposte, non decisioni approvate
1. Conservare la verità del mondo separata da conoscenze, credenze e ipotesi dei PNG.
2. Registrare per ogni acquisizione fonte, destinatario e momento; applicare il
   filtro anche a recupero dei ricordi, riassunti e risultati degli strumenti.
3. Evitare che una frase inventata dal PNG crei da sola rapporti, lettere o eventi
   nel passato canonico. La procedura di convalida resta da progettare.
4. Una scheda espressiva dovrebbe legare valori, obiettivi, relazioni e modo di
   reagire alle situazioni, senza imporre tic ripetuti o monologhi ad ogni turno.
5. Recuperare informazioni importanti quando diventano pertinenti; una mancata
   lettura non deve essere razionalizzata dopo come un segreto deliberato.
6. Valutare attivazione su eventi/scena per contenere chiamate e attese. È ancora
   aperta la scelta sul comportamento fuori scena.
7. Distinguere prevenzione dell'accesso a un segreto da invenzione casuale dello
   stesso contenuto: il primo è verificabile sul contesto, il secondo richiede
   ulteriori controlli e non ha garanzia assoluta con testo libero.

## Suggested Evaluation
Non basta un punteggio medio di gradevolezza. Confrontare sistema corrente e
proposta sulla stessa scena, con più ripetizioni e identico modello:
- Sconosciuto: nessun uso del nome prima di una presentazione o fonte autorizzata.
- Lettere: nessuna relazione pregressa introdotta retroattivamente per facilitare l'indagine.
- Testimone assente: nessun ricordo dell'evento prima di una comunicazione ammessa.
- Richiamo tempestivo: il compagno considera una conoscenza pertinente già presente;
  distinguere omissione da reticenza stabilita, secondo il contratto da confermare.
- Personalità: giudizi umani in cieco su reazioni distintive e coerenti.
- Durata: ripetere dopo distrazioni, riassunti, salvataggio e ripresa; misurare sia
  accessi ai dati sia affermazioni prodotte. Includere prove in italiano.
- Costi: numero di chiamate, token e latenza per turno insieme agli errori.
Tutto questo è proposto: nessun test applicativo è stato eseguito.

## User Evidence and Open Decisions
L'utente riferisce sconosciuti che conoscono già il nome del protagonista,
compagni che rivelano una corrispondenza pregressa con una vittima solo molto dopo,
e caratterizzazione piatta. Sono scenari di regressione richiesti, non episodi
riprodotti da questa ricerca. Le domande sui confini del passato, reticenza,
deduzioni, attività fuori scena e importazione rimangono aperte.
L'utente conferma che l'italiano può essere recuperato in seguito; non sono stati
scaricati cataloghi né contattati autori.

## Next Step
Usare questi risultati nel ticket 01 per completare il contratto, poi nel ticket 02
per confrontare soluzioni. Il test minimo utile è una breve indagine con pochi PNG,
non un'intera società: presentazioni, un segreto, una falsa informazione e una
relazione preesistente verificabile. Nessun prototipo o implementazione avviati.
