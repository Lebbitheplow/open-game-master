# Un proprietario per ogni cosa del gioco

Tipo: architettura.

## Artifact Graph
- Artifact ID: `artifact:ogm-domain-owners`
- Role: spec
- Standalone: true

## Perché

Dieci turni dal vivo sulla Zattera (2026-11-16) hanno sbagliato gli oggetti in tre modi diversi, ognuno
corretto con una pezza diversa (PR #53, #54, #55), e il prossimo modo di sbagliare era già lì:

- turno 3: Brakk strappa la bussola a Kranz; il master usa `grant_item`, Kranz tiene la sua. Due bussole.
- turno 8: Brakk dà tre pezzi di pesce; ne passa uno, gli altri restano a lui senza che il racconto lo dica.
- turno 9: il master passa un pezzo ad Amleth con `handle_item`, poi l'arbitro del palco racconta la stessa
  presa e il server ne passa un secondo.

Non è un errore di regole. È che **la stessa cosa ha molti scrittori e molti decisori**, e nessuno sa cosa
fanno gli altri. Misurato su `main` (`1ee38ef64`…`f209b625c`):

| Cosa | Chi la scrive oggi |
|---|---|
| Scheda di eroi e compagni | `patchSheet` (scrive qualunque campo) chiamato da **175 file** fuori da `src/lib/db/`. Campi più scritti: `conditions` 91 punti, `resources` 28, `equipment` 23, `tempHp` 14, `conditionMeta` 13, `currentHp` 9, `spellcasting` 8, `gold` 4 |
| Scontri | scrittori dell'incontro chiamati da **91 file** |
| Oggetti a terra | `dropped-items` / `gear-ground.ts`, ignorati dal palco |
| Decisori sugli oggetti in un turno | strumenti del master (`grant_item`, `remove_item`, `use_item`, `handle_item`), mosse dell'arbitro del palco, prompt del guardiano dello stato, moduli di regole (infusioni, trappole, manette, negozi) |
| Racconto | testo libero del master, scritto **durante** i calcoli, prima che il palco agisca |

Il database è già solido sotto: `turn-journal.ts` registra con trigger ogni riga che un turno tocca, così
un revert la riporta indietro. Il problema è sopra il database: chi decide e chi scrive.

## Principio

1. **Ogni dominio del gioco ha un solo proprietario.** È codice del server, non un modello. È l'unico che
   può scrivere i dati del suo dominio. Tutti gli altri lo chiamano.
2. **Chi decide non scrive, chi scrive non decide.** I modelli (master, voci, arbitro, interpreti)
   propongono **comandi**; il proprietario li valida e li applica, oppure li rifiuta dicendo perché.
3. **Ogni cambiamento è un fatto del turno.** Il proprietario registra un evento per ogni comando
   applicato. Il racconto si scrive **dopo**, a partire da quei fatti: non può dire una cosa che non è
   successa, né tacerne una che è successa.
4. **Il confine è controllato da un test.** Il setter grezzo di un dominio è privato del suo proprietario;
   un test fallisce se un altro file lo importa. Un nuovo scrittore non può nascere per distrazione.

## I domini

| Dominio | Dati | Proprietario (nuovo modulo) | Comandi |
|---|---|---|---|
| Oggetti | `equipment`, `gold`, attunement, cariche degli oggetti, schede del cast, oggetti a terra | `src/lib/owners/items.ts` | `give`, `take`, `find`, `lose`, `consume`, `drop`, `pickUp`, `buy`, `sell`, `spendCharge` |
| Corpo | `currentHp`, `tempHp`, `maxHp`, `deathSaves`, `conditions`, `conditionMeta`, esaurimento | `src/lib/owners/body.ts` | `damage`, `heal`, `setTempHp`, `addCondition`, `endCondition`, `deathSave`, `stabilize` |
| Risorse | `resources`, slot, usi dei privilegi, dadi vita | `src/lib/owners/resources.ts` | `spend`, `restore`, `rest` |
| Crescita | `xp`, livello, privilegi, incantesimi conosciuti | `src/lib/owners/growth.ts` | `awardXp`, `levelUp`, `learn` |
| Personaggi non giocanti | `npcs.state`, tier, luogo, memorie | `src/lib/owners/cast.ts` | `setCustody`, `move`, `drank`, `ate`, `remember`, `rename` |
| Scontro | incontro, iniziativa, budget del turno, nemici | `src/lib/owners/fight.ts` | `start`, `join`, `act`, `endTurn`, `end` |
| Mondo | luoghi, orologio, mappa | `src/lib/owners/world.ts` | `travel`, `advanceClock`, `place` |
| Profilo | nome, ritratto, storia | resta del giocatore (UI), fuori dal turno | — |

Lo slot DB resta dov'è: lo schema non cambia per questo. Cambia chi può chiamare il setter.

## Il contratto di un proprietario

- **Ingresso:** un comando tipato (zod), con chi lo chiede (`master`, `stage`, `interpreter:<dominio>`,
  `rule:<modulo>`, `player`, `console`) e il turno.
- **Validazione:** possesso (chi dà ha l'oggetto), presenza (stessa scena), regole del dominio, scontro
  (azione/interazione disponibile). Il rifiuto è un risultato tipato con il motivo, mai un'eccezione silenziosa.
- **Idempotenza nel turno:** un comando identico a uno già applicato in questo turno (stesso tipo, soggetti,
  oggetto) è riconosciuto e non rifatto. È la regola che oggi è sparsa fra `takeRecorded` e
  `heldByCastRefusal`; diventa una sola, nel proprietario.
- **Effetto:** scrive tramite il suo setter privato, nella stessa transazione registra l'evento del turno.
  Il revert continua a funzionare com'è (`turn-journal.ts`).
- **Uscita:** l'evento (`{dominio, comando, soggetti, prima → dopo, motivo}`), letto da racconto, UI e memorie.

## Chi decide

I modelli non scrivono e non chiamano setter. Ognuno ha un compito solo:

| Modello | Compito | Produce |
|---|---|---|
| **Arbitro** (oggi parte del master, Sol) | Regole: cosa richiede un tiro, CD, chi agisce, esito meccanico | Comandi a Corpo, Risorse, Scontro; esiti dei tiri |
| **Voci** (E4B) e **Ego** (Luna) | Cosa vuole fare e dire ogni personaggio | Intenzioni |
| **Arbitro del palco** (Sol) | Come finisce l'azione di un personaggio | Esito testuale e tiro, **niente oggetti** |
| **Interprete degli oggetti** (Luna) | L'unico che legge parole su oggetti: righe degli eroi, esiti dei tiri, esiti del palco | Comandi a Oggetti |
| **Narratore** (Sol) | Racconta i fatti del turno, nient'altro | Prosa |

Il master che oggi fa arbitro, contabile e narratore insieme si divide in **arbitro** e **narratore**, come
già fa il palco: il narratore riceve fatti immutabili.

Gli strumenti del master che spostano oggetti nel racconto (`grant_item`, `remove_item`, `handle_item` per i
passaggi) escono dal suo elenco. Restano solo quelli senza interpretazione: negozio (`buy`, `sell`), bottino
di un nemico sconfitto, ricompense di una missione.

## Il turno

1. **Azione dei giocatori.** Le righe degli eroi entrano nel turno così come sono scritte.
2. **Arbitro.** Risolve le regole con tiri e comandi a Corpo, Risorse, Scontro. Non scrive prosa.
3. **Palco.** Voci in parallelo, arbitro del palco in ordine: esiti e tiri. Nessun comando sugli oggetti.
4. **Interprete degli oggetti.** Legge righe degli eroi + esiti dell'arbitro + esiti del palco e propone i
   movimenti. Il proprietario Oggetti valida e applica: gli eventi sono il registro di cosa è passato di mano.
5. **Narratore.** Scrive il racconto dai fatti: eventi applicati, comandi rifiutati (raccontati come non
   avvenuti), parole delle voci.
6. **Guardiani.** Restano solo come controllo: confrontano il racconto con gli eventi. Una divergenza è un
   errore del narratore da correggere, non uno stato da riparare.

## Applicazione del confine

- `patchSheet` diventa privato di `src/lib/db/sheets.ts`; ogni proprietario ha un setter per i suoi campi
  (`setEquipment`, `setVitals`, `setResources`, …), esportato solo verso il suo proprietario.
- `scripts/test-domain-owners.mjs`: per ogni setter, la lista dei file che lo possono importare (il
  proprietario e `src/lib/db/`). Un import in più fa fallire il test e nomina il file. Durante la migrazione
  il test ha una lista di eccezioni che può solo scendere; a fine migrazione è vuota.
- Le regole SRD (infusioni, trappole, manette, attacchi) non cambiano logica: invece di `patchSheet` chiamano
  il proprietario con `rule:<modulo>`.

## Fuori portata

- Riscrivere le regole SRD o cambiarne il comportamento.
- Cambiare la UI, salvo che legga gli eventi invece di ricalcolarli.
- Cambiare lo schema del database, salvo una tabella eventi se `turn_rows` non basta a dare il prima → dopo
  leggibile per il racconto.

## Rischi e decisioni aperte

- **Allontanamento da upstream.** Questo repository è un fork di `Lebbitheplow/open-game-master`. Toccare 175
  file rende i merge da upstream difficili. **Decisione aperta:** accettare la divergenza, oppure tenere i
  proprietari come strato sopra il codice upstream (meno file toccati, confine meno netto).
- **Latenza.** L'interprete degli oggetti aggiunge una chiamata a Luna per turno (pochi secondi su ~110–150 s).
- **Interprete che sbaglia.** Un movimento letto male è validato dal proprietario: se chi dà non ha l'oggetto,
  è rifiutato e raccontato come non avvenuto. Un movimento valido ma inventato resta un rischio: la misura è
  la prova sui turni registrati.
- **Arbitro senza prosa.** Il master oggi intreccia tiri e prosa; separarli cambia il ritmo del racconto.
  Da misurare sui turni registrati prima del rilascio.

## Fette di implementazione

Ogni fetta si chiude con test verdi, prova sui turni registrati e 10 turni dal vivo sulla Zattera.

1. **Il confine, in sola misura.** `test-domain-owners.mjs` con la lista di eccezioni di oggi (175 file).
   Nessun comportamento cambia; da qui la lista può solo scendere.
2. **Proprietario Oggetti.** `owners/items.ts` con comandi, validazione, idempotenza ed eventi; terreno del
   luogo da `dropped-items`. I 23 punti che scrivono `equipment`, le 4 di `gold`, le schede del cast, il
   palco (`moveThing`) passano da lì. `takeRecorded` e `heldByCastRefusal` si sciolgono nell'idempotenza.
3. **Interprete degli oggetti e arbitro senza oggetti.** Il palco smette di proporre `moves`; il master perde
   gli strumenti di passaggio; l'interprete legge le parole e comanda. Prova: i 10 turni della Zattera
   (fixture dal DB) devono finire con schede uguali ai fatti raccontati.
4. **Narratore dai fatti.** Il master si divide in arbitro e narratore; il racconto si scrive dopo gli eventi.
5. **Corpo** (91 punti su `conditions`, HP).
6. **Risorse.**
7. **Personaggi non giocanti** (5 file) e **Mondo**.
8. **Scontro** (91 file): ultimo, è il più grande.
9. **Confine chiuso.** Lista di eccezioni vuota; `patchSheet` non è più esportato.

## Stato

- **Fetta 1, fatta.** `scripts/test-domain-owners.mjs` con `scripts/domain-owners-baseline.json`: 175 file
  all'inizio, 161 dopo la fetta 2 (più i 16 di `patchWithItems`).
- **Fetta 2, fatta in questa forma:**
  - `src/lib/db/owner-gate.ts`: `patchSheet` rifiuta `equipment`, `gold` e `copper` se il cancello degli
    Oggetti è chiuso. Con `OGM_OWNER_GATE=strict`, attivo in ogni suite `enforce-harness`, lancia
    un'eccezione; in gioco scrive comunque e nomina nel log chi ha scritto fuori, una volta per punto
    del codice, così un tavolo non perde un turno per uno scrittore non ancora migrato.
  - `src/lib/owners/items.ts`: `writeItems`, `saveEquipment` (spostata da `gear-store.ts`), `give`
    (passaggio atomico) e `handedThisTurn` (lo stesso passaggio nello stesso turno non si ripete).
  - Gli scrittori trovati facendo girare tutte le suite con il cancello in misura (55 punti in 26 file)
    ora passano da `writeItems`.
  - `takeRecorded` è sciolto: il palco passa il turno a `handle_item` e chiede al proprietario.
- **Porte generiche chiuse.** `writeItems` accetta solo `equipment`, `gold` e `copper`: con qualunque
  altro campo lancia un'eccezione. Una modifica che tocca anche altri campi (l'annulla, la UI della scheda,
  `audited-patch.ts`, riposi, cure, negozio) passa da `src/lib/dm/sheet-patch.ts` `patchWithItems`, che la
  divide in due: gli oggetti al proprietario, il resto a `patchSheet`. I 16 file che la chiamano sono
  contati come scrittori diretti in `test-domain-owners.mjs`, perché scrivono ancora da soli gli altri
  domini.
- **`heldByCastRefusal` sciolto.** La regola ("un oggetto che un personaggio presente in scena tiene in
  mano non si crea, si passa") ora è nel proprietario: `heldInScene`. Vale sulla scrittura stessa,
  tramite `grant`, chiamato da `grant_item` per il master e per il palco. `grantRefusal` è la stessa regola
  chiesta prima che una chiamata venga eseguita o proposta al giocatore.

## Verifica

- Unità: ogni proprietario, comando per comando (valido, rifiutato, ripetuto nel turno).
- Confine: `test-domain-owners.mjs` a ogni fetta.
- Integrazione: le suite esistenti (`test-enforce-*`, `test-npc-*`) restano verdi; cambiano solo le asserzioni
  sui nomi degli strumenti rimossi.
- Sistema: replay dei turni registrati della Zattera (copia del DB, modelli veri) con confronto schede ↔ fatti.
- Dal vivo: 10 turni sulla Zattera per fetta, con il driver `/tmp/cast-trial/turn.py`.

## Gates
- Attempt: la spec e le fette 1–3 fino alla consegna; le fette 4–9 sono tentativi successivi.
- Budget, tempo, tentativi massimi: nessuno.
- Approvazioni: spec, modifiche locali e test non ne richiedono. Push, merge e deploy: date dall'utente per
  questo lavoro ("pusha mergia fai che vuoi", 2026-11-16); vincolo esistente: mai riavviare il server con un
  turno `running` o `awaiting_rolls`. **Aperta:** la scelta sull'allontanamento da upstream (vedi sopra),
  che blocca la fetta 9 e la forma delle fette 5–8, non le fette 1–4.
- Versione esatta: nessuna.
- Blocchi esistenti: nessuno trovato. Cercati: chiamanti di `patchSheet`, scritture SQL per tabella, scrittori
  dell'incontro, `turn-journal.ts` e `test-turn-journal.mjs` (classificazione obbligatoria delle tabelle
  nuove), `turn-ledger.ts`.
