# La scheda del cast: i personaggi di primo livello tengono le cose come i compagni

Tipo: architettura.

## Artifact Graph
- Artifact ID: `artifact:ogm-npc-cast-sheet`
- Role: spec
- Standalone: true

## Perché

Un personaggio di primo livello (tier `primary`) ha mente, memoria, voce e il suo turno sul palco
come un compagno, ma le sue cose sono una lista di parole, `npc.state.carries`, riscritta per intero
da `npc_state`. Eroi e compagni hanno invece una scheda (`character_sheets`) con un inventario vero, e il server
sa passare un oggetto da una scheda all'altra in un colpo solo e con controllo di possesso:
`handle_item` con `action: "hand"` (`src/lib/dm/gear-tool.ts`, `handOver`).

Fra un eroe e un personaggio non giocante quel passaggio non esiste. Il master deve fare due metà a mano
(`grant_item`/`remove_item` sulla scheda + `npc_state carries` sulla riga), e una metà dimenticata
fa sparire o raddoppiare l'oggetto senza che niente se ne accorga.

### Fatti (Zattera, `data/npc-test.sqlite`, campagna `d8dcacf5-…`)
- Messaggio 204: il master narra «la chiave … è nelle vostre mani, Brakk» senza `grant_item`;
  la chiave non è mai arrivata sulla scheda di Brakk (lì il palco non c'era: si combatteva).
- Turno `7a5b3ca2-…`: Brakk accetta il rum, beve, lo **restituisce**; il master scrive «il rum resta
  un'offerta condizionata» decidendo al posto di Mairon. Il rum che resta a Mairon è giusto; persa è
  l'azione di Brakk.
- Stesso turno: il pesce è stato trattato bene (`grant_item` su Brakk, tolto a Ioshua; divisione
  negata perché sulla scheda non c'è un coltello).
- Il palco (`npc-stage.ts`) cambia solo `carries` dei personaggi non giocanti e per regola non tocca gli eroi; il
  commit `a23b22e72` (ramo `hero-deeds-ledger`) ci ha aggiunto a mano un `grant_item` all'eroe:
  una seconda copia della stessa logica, solo per il palco.

## Obiettivi
1. Ogni personaggio di primo livello ha una **scheda del cast**: una scheda vera in `character_sheets`, di
   un terzo tipo, né eroe né compagno.
2. Le sue cose stanno nell'inventario di quella scheda, unica fonte di verità.
3. `grant_item`, `remove_item`, `use_item` e `handle_item` (compreso `hand`) funzionano su una scheda del
   cast come su quella di un eroe, in entrambe le direzioni. Un passaggio eroe ↔ personaggio non giocante è **una** chiamata,
   eseguita dal server.
4. Il master, le carte del giocatore e l'arbitro del palco passano tutti da lì.

## Non obiettivi
- Appartenenza al gruppo: lato in combattimento, chi comanda, livelli, punti esperienza, congedo, valori,
  agenda. Volodar non è un alleato.
- Combattimento dalla scheda: punti ferita, CA, iniziativa restano quelli di oggi (`stat_block`,
  `party-npcs-fight`). La scheda del cast ha punti ferita che per ora nessuna regola legge.
- Interfaccia per vedere o modificare la scheda del cast.
- Controllo sulla narrazione («la prosa dice che un oggetto è passato ma nessuna chiamata lo ha
  registrato»): è il passo successivo, con una spec sua; questa lo rende possibile, perché dopo
  esiste una sola chiamata da cercare.
- Personaggi non giocanti di secondo livello: tengono `carries` come oggi.

## Stato di arrivo

### Il tipo di scheda
- `character_sheets.sheet_kind TEXT NOT NULL DEFAULT ''`: `''` per le schede di oggi (eroe o
  compagno, distinti da `is_companion` come ora), `'cast'` per la nuova.
- `npcs.cast_sheet_id TEXT NOT NULL DEFAULT ''`: il collegamento, gemello di `companion_sheet_id`.
  Non si riusa `companion_sheet_id`: in 16 file significa «è un compagno».

### Invariante che protegge il resto (decisione chiave)
- `listSheets(campaignId)` **non restituisce mai** le schede del cast. Le sue 347 chiamate, e i 61 file
  che leggono «non compagno = eroe», restano come sono.
- Una funzione nuova, `listCastSheets(campaignId)`, le elenca per chi le chiede apposta.
- `getSheetById` le restituisce: chi ha l'id ne ha bisogno (inventario, rollback).

### Creazione
- Una scheda del cast nasce la prima volta che serve a un personaggio di primo livello (come
  `companionNpcFor` fa per i compagni): passa a `primary`, il palco lo chiama, un'azione sull'inventario
  lo nomina.
- Campi obbligatori: nome dalla riga `npcs`; razza, classe e caratteristiche dallo `stat_block` se c'è,
  altrimenti un popolano SRD (caratteristiche 10, 4 punti ferita, CA 10). Sulla Zattera
  `stat_block` è vuoto per tutti e sette.
- Proprietario: un utente bot «cast», **uno per campagna**, con id `cast_<uuid>`.
  - Non si usa `comp_`: `isCompanionUserId` ne farebbe un compagno.
  - `deleteCampaign` e il rollback ripuliscono i bot `cast_` come fanno con `comp_`.
- `carries` della riga diventa l'inventario: una voce per oggetto, quantità 1, nome com'è scritto,
  nome SRD quando corrisponde (stesso calcolo di `grantItemMath`). Poi `carries` si svuota.

### Strumenti
- I quattro strumenti dell'inventario trovano una scheda per `characterId` (e `toCharacterId`) fra
  eroi, compagni **e cast**, anche per nome del personaggio non giocante. Tutti gli altri strumenti continuano a
  vedere solo eroi e compagni.
- `hand` fuori dal combattimento non chiede la distanza; in combattimento resta com'è.
- `npc_state` perde il campo `carries` per i personaggi con scheda del cast; se viene passato, l'errore
  indica la chiamata giusta (`handle_item hand`, `grant_item`, `remove_item`).

### Lettori di `carries` che passano alla scheda
- `npc-mind.ts`: «What you have on you now…», `knowsOfThing`, `own`.
- `npc-stage.ts` / `npc-stage-logic.ts`: chi c'è e cosa ha, per l'arbitro.
- `npc-state-logic.ts` `npcStateWords`: la riga di presentazione del personaggio.
- `npc-state-guard.ts`: la riga «record».

### Il palco
- Gli esiti dell'arbitro sugli oggetti diventano movimenti, non liste:
  `gives: [{ thing, to }]` (da chi agisce a una persona presente, eroe compreso),
  `takes: [{ thing, from }]` (solo da un personaggio non giocante; da un eroe resta un tentativo che il tavolo risolve),
  `finds: [thing]` (dal mondo, per esempio un pesce pescato), `loses: [thing]` (perso, buttato).
- Il server li esegue con `hand`, `grant_item`, `remove_item`. Un movimento che il server rifiuta (chi dà
  non ha l'oggetto, manca lo spazio) non cambia niente e finisce nei fatti come «non riesce».
- Dal commit `a23b22e72` restano: le parole degli eroi date alle voci e all'arbitro, e il confronto
  senza articolo iniziale. Si toglie `heroGains`/`handToHero`: lo sostituisce `hand`.

### Restano invariati
- Iniziativa, pannello del gruppo, interfaccia, punti esperienza, riposi, scelta del personaggio di un utente: partono da
  `listSheets` o da `user_id`, quindi non vedono il cast.
- I compagni: niente cambia.

## Query SQL dirette su `character_sheets` (fuori da `sheets.ts`)

| Dove | Cosa fa | Con il cast |
|---|---|---|
| `dm/rollback.ts` id/nome, istantanea | ripristino dei turni | **deve** includerle: il rollback rimette a posto anche gli oggetti del cast |
| `dm/rollback.ts` bot prima/dopo | elimina i bot rimasti senza scheda | aggiungere i bot `cast_` |
| `db/campaigns.ts` `deleteCampaign` | elimina i bot `comp_` | aggiungere `cast_` |
| `db/npcs.ts` `liveSheetIds` | compagno vivo per `companion_sheet_id` | innocua (gli id del cast non sono mai `companion_sheet_id`) |
| `db/companion-npcs.ts` (3) | ritorno o partenza di un compagno, voci della libreria | innocue (nessun `library_character_id`, nessun `companion_sheet_id`) |
| `usage/ledger.ts` | conteggio dei personaggi per campagna | escludere `sheet_kind = 'cast'` |
| `db/home-glance.ts`, `account-deletion.ts`, `rollback.ts` `owns` | per `user_id` di persone vere | innocue |
| `db/characters.ts`, `pregen-offers.ts`, `core.ts` (join con la libreria) | partono da `library_character_id` | innocue |
| `db/dm-whispers.ts` (4) | join per `character_id` | innocue |
| manutenzione (`species-spell-resync`, `feat-spell-repair`, `homebrew-rename`, `item-cast-credits`, `core.ts` migrazioni) | ricalcoli su tutte le schede | innocue: una scheda del cast è una scheda valida |

Dentro `sheets.ts` cambiano `listSheets` (esclude), `listCastSheets` (nuova) e l'inserimento
(`sheet_kind`). Le altre query sono per id o per `user_id`.

## Migrazione
- Colonne aggiunte con lo schema esistente (`ALTER TABLE … ADD COLUMN` di `core.ts`): non distruttive.
- I dati non si convertono tutti all'avvio. Ogni personaggio di primo livello riceve la sua scheda al primo uso, e in
  quel momento i suoi `carries` passano alla scheda. La Zattera in corso continua: Mairon tiene il suo rum.
- Indietro: un server vecchio ignora le colonne, ma non vede le cose passate sulle schede del cast.
  Nessuna compatibilità all'indietro richiesta.

## Rischi
- Una query che legge tutte le schede di una campagna senza passare da `listSheets` e tratta ogni
  scheda come eroe. Mitigazione: la tabella qui sopra, più un test che conta eroi e cast in ogni
  percorso principale del turno.
- Una scheda del cast colpita da uno strumento che non è dell'inventario (cura, incantesimi). Mitigazione:
  la risoluzione allargata vale solo per i quattro strumenti; un test lo prova.
- Doppia verità sui punti ferita (scheda e `stat_block`). Accettata finché il combattimento non passa
  alla scheda; la scheda del cast non li mostra a nessuno.

## Fette di lavoro, in ordine
1. **Schema e scheda.** `sheet_kind`, `cast_sheet_id`, utente bot `cast_`, `castSheetFor(npc)` con
   i campi derivati, `listSheets` esclude, `listCastSheets`, `carries` migrati al primo uso, ledger,
   pulizie di rollback e `deleteCampaign`.
2. **Strumenti.** Risoluzione allargata per i quattro strumenti dell'inventario; `hand` tra eroe e cast
   in entrambe le direzioni; `npc_state` senza `carries` per chi ha la scheda; prompt del master aggiornato.
3. **Lettori.** Mente, palco, presentazione, guardiano dello stato leggono la scheda.
4. **Palco.** Movimenti `gives/takes/finds/loses` eseguiti dal server; via `heroGains`/`handToHero`;
   restano parole degli eroi e confronto senza articolo.

Ogni fetta lascia il gioco funzionante; la 4 dipende dalla 2.

## Verifica
- Unità: `castSheetFor` (campi da `stat_block` e da popolano), migrazione di `carries`, movimenti del palco
  (rifiuto se chi dà non ha l'oggetto, nessun movimento che prende da un eroe).
- Integrazione (mondo finto, `scripts/`):
  - **chiave:** Volodar dà la chiave a Brakk con una `hand`; la chiave è sulla scheda di Brakk e non più su
    quella di Volodar;
  - **rum:** Mairon dà, Brakk beve e restituisce; alla fine il rum è di Mairon, uno solo;
  - `hand` da chi non ha l'oggetto viene rifiutata e non cambia niente;
  - `listSheets` non restituisce il cast; iniziativa, gruppo e conteggi uguali a prima;
  - una cura con `characterId` del cast viene rifiutata;
  - il rollback di un turno rimette la chiave dov'era;
  - `deleteCampaign` elimina il bot `cast_`.
- Regressione: `test-npc-stage`, `test-npc-mind`, `test-npc-state`, `test-npc-mind-model`,
  `test-party-npcs-fight`, più la suite completa prima del merge (tocca schema e risoluzione schede).
- Dal vivo, a mano: un turno della Zattera con uno scambio fra Brakk e un personaggio non giocante, letto nel DB.

## Domande aperte
- Nessuna che blocchi. Da confermare guardando un turno vero: se dopo la fetta 2 il master usa
  `hand` da solo o serve anche il controllo sulla narrazione (spec successiva).

## Gates
- Attempt: la consegna delle quattro fette fino alla consegna.
- Budget, tempo, tentativi massimi: nessuno.
- Approvazioni: modifiche locali e test non ne richiedono. Merge e deploy seguono la prassi già usata
  in questo progetto per le PR #39–#52; vincolo esistente: mai riavviare il server con un turno
  `running` o `awaiting_rolls`.
- Versione esatta: nessuna.
- Blocchi esistenti: nessuno trovato. Cercati: vincoli `NOT NULL` di `character_sheets`
  (`core.ts`), uso di `companion_sheet_id`, query dirette su `character_sheets`, prefissi dei bot
  (`users.ts`, `rollback.ts`, `campaigns.ts`).
