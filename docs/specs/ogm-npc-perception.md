# Percezione deterministica dei PNG: sensi, corpo, emozioni, legami

## Artifact Graph

- Artifact ID: ogm-npc-perception
- Role: spec
- Standalone: true
- Related: `ogm-domain-owners` (un proprietario per dominio), `ogm-npc-state`, `ogm-npc-ego`,
  `ogm-npc-cast-sheet`, `ogm-npc-isolation-design`.

## Gates

- attempt: dalla spec al rilascio della fetta 8 e alla prova sulla Zattera osservatore.
- budget, time, maximum attempts: nessuno fissato.
- approvals: push, PR, merge, deploy e turni live sulla Zattera già autorizzati dall'utente.
- exact version: nessuna.
- existing blocks: nessuno trovato (cercati `src/lib/dm/npc-*.ts`, `src/lib/db/npc-minds.ts`,
  `src/lib/db/core.ts`, `docs/specs/ogm-*`).

## Tipo

Architettura: componenti, contratti, stato, rilascio. Nessuna compatibilità all'indietro richiesta
oltre a quanto scritto in "Dati esistenti".

## 1. Problema (fatti, Zattera osservatore 2026-11-17)

1. **La percezione è la prosa del narratore.** `runStage` passa a ogni mente
   `stageSenses(narration, [], heroLines)`: la narrazione del master tagliata a 1000–1200 caratteri
   e le parole dell'eroe; identica per tutti, al buio o nella tempesta, chiunque guardi altrove.
2. **La prosa diventa memoria.** `handleNpcSpeak` salva `perceives` come memoria `perceived` di
   tutti i presenti; `everyoneHears` salva ogni frase tra «» della narrazione per tutti i presenti,
   a qualunque distanza. Sulla Zattera 1260 memorie su 1660 sono copie di prosa; il limite di 40
   (`MIND_MEMORY_LIMIT`) espelle i fatti.
3. **Le azioni degli altri PNG si perdono.** Le menti sono interrogate in parallelo, poi l'arbitro
   va in ordine e salva ogni esito solo per chi ha già agito
   (`told = present.filter(!waiting)`): il primo della fila non sa mai cosa hanno fatto gli altri.
4. **Nessuno spazio.** Sulla scena di esplorazione non ci sono posizioni (pedine solo sulla mappa di
   combattimento): sussurri, vista, contatto non si possono decidere.
5. **Corpo povero.** `NpcState` ha solo `drankAt`, `ateAt`, `condition`; nessun freddo, bagnato,
   sonno, sfinimento, dolore. Brakk è crollato di freddo e fame; i PNG intorno non sentivano nulla.
6. **Nessuna emozione come stato.** Esiste il temperamento (`NpcPersonality`: drive, diligence,
   boldness, warmth, empathy, composure, da −3 a 3) e il "PENSA" libero, che riparte da zero a ogni
   turno.
7. **Legami deboli.** `relationships` registra PNG→eroe (tutte a 0 sulla Zattera);
   `agency.relations` (PNG↔PNG, punteggio e nota) non è aggiornato dagli eventi.
8. **Oggetti invisibili al bisogno.** Kaku affamato chiedeva cibo a Brakk catatonico con 40 gallette
   a terra (corretto in parte da #62: ora le vede, ma niente lega il bisogno all'oggetto).

## 2. Obiettivo e non-obiettivi

**Obiettivo.** Ciò che un PNG percepisce, sente nel corpo, prova e sa di chi lo circonda è
**calcolato dal server** da stato autorevole ed eventi strutturati, filtrato dai suoi sensi, dalla
sua posizione e dalla sua condizione. Stessi dati → stesso testo. Il modello del PNG decide cosa
vuole, dice, tenta e pensa; non decide cosa è successo, cosa ha visto o cosa prova il suo corpo.

**Non-obiettivi.** Sostituire arbitro o dadi; fisica; mappa completa ai PNG; percezione per i PNG di
secondo piano (restano voce del narratore); interfaccia nuova per il giocatore (salvo il debug in
fetta 8).

## 3. Principi

- **Il server possiede**: eventi, posizioni, corpo, emozioni, legami, memoria. Il modello propone.
- **Un proprietario per dominio** (`ogm-domain-owners`): nuovi domini Percezione e Animo con un solo
  scrittore ciascuno.
- **Percepire è filtrare eventi**, non riassumere prosa.
- **Fatto ≠ credenza**: ciò che ha visto è un fatto suo; ciò che gli è stato detto è una credenza
  con la fonte.
- **Parole, non numeri**, nel prompt della mente: i numeri restano al server.
- **Il modello interpreta solo l'ambiguo**, scegliendo da liste chiuse; il server applica i limiti.

## 4. Componenti

| Componente | File (nuovo) | Ruolo | Scrive |
| --- | --- | --- | --- |
| Registro eventi di scena | `src/lib/db/scene-events.ts` | eventi strutturati per luogo e turno | tabella `scene_events` (solo l'arbitro del palco e il turno degli eroi via proprietario) |
| Zone | `src/lib/owners/places.ts` + `zones-logic.ts` | zone di un luogo, posizione di PNG ed eroi | `place_zones`, `npcs.zone`, posizione eroi |
| Sensi | `src/lib/dm/senses-logic.ts` (puro) | per ogni osservatore: quali eventi percepisce e con quale canale | niente (calcolo) |
| Corpo (moodle) | `src/lib/dm/moodles-logic.ts` (puro) + proprietario `cast` | livelli 0–4 di fame, sete, sonno, sfinimento, freddo, bagnato, dolore, nausea | `npcs.state` (nuovi campi) |
| Animo (moodlet) | `src/lib/owners/mood.ts` + `mood-logic.ts` | emozioni con fonte, peso, durata; appraisal | `npc_moodlets` |
| Legami | `src/lib/owners/bonds.ts` + `bonds-logic.ts` | fiducia, affetto, paura verso ciascuno, con ragioni | `npc_bonds` |
| Memoria | `src/lib/db/npc-minds.ts` (esistente) | evento percepito → una riga; importanza | `npc_memories` |
| Quadro percettivo | `src/lib/dm/perception-frame-logic.ts` (puro) | compone il testo del prompt per canale | niente |

## 5. Eventi strutturati

### 5.1 Contratto

```ts
type SceneEvent = {
  id: string; campaignId: string; turnId: string; instant: number; place: string;
  actor: string;                 // nome di PNG o eroe; "" per l'ambiente
  verb: SceneVerb;               // vocabolario chiuso, 5.2
  targets: string[];             // persone toccate dall'azione
  object?: string;               // la riga d'oggetto come la nomina il registro Oggetti
  zoneFrom?: string; zoneTo?: string;
  volume: "silent" | "whisper" | "normal" | "shout" | "noise";
  covert: boolean;               // tentato di nascosto
  stealth?: number;              // tiro di Furtività/Rapidità di mano se covert
  success: boolean;
  speech?: string;               // parole dette, verbatim
  outcome: string;               // la frase dell'arbitro, per il narratore
};
```

### 5.2 Verbi

`parla, sussurra, grida, si_sposta, prende, da, posa, mangia, beve, spinge, afferra, colpisce,
tocca, abbraccia, lega, slega, ruba, nasconde, osserva, dorme, si_sveglia, fugge, minaccia,
aiuta, cura, altro`. Più gli eventi d'ambiente (`actor: ""`): `meteo, luce, onda, rumore, tempo`.

### 5.3 Chi li produce

- **Arbitro del palco**: oltre a `success`/`failure.outcome`, restituisce i campi strutturati per
  ogni ramo (`verb`, `targets`, `object`, `zoneTo`, `volume`, `covert`). Il server tira il dado
  (già oggi) e, se `covert`, il tiro di Furtività dell'attore dal suo foglio del cast.
- **Righe degli eroi**: un evento `parla` con le parole dell'eroe (volume dal testo: "sussurra" →
  whisper, "grida" → shout; default normal) e, dopo il turno, gli eventi dagli esiti dei tiri e dai
  comandi applicati (Oggetti, Corpo, Mondo).
- **Proprietari**: ogni comando applicato di Oggetti (`give`, `take`, `pickUp`, `drop`, `consume`),
  Corpo, Mondo (`advanceClock`, meteo, viaggio) produce il suo evento. Un evento rifiutato non
  esiste.
- **Il narratore non produce eventi.**

## 6. Zone

- Un luogo ha da 1 a 6 **zone** con nome breve e adiacenza (es. Zattera: `centro`, `bordo nord`,
  `bordo sud`, `poppa`; tutte adiacenti al centro). Generate una volta quando il luogo nasce o
  quando un PNG di primo piano ci entra la prima volta: un modello propone da `layoutDescription`,
  il server valida (≤6, nomi unici, grafo connesso) e salva. Modificabili dal master con uno
  strumento.
- **Distanza** fra zone: `stessa` (contatto possibile), `adiacente` (voce normale), `lontana`.
- **Posizione**: ogni PNG e ogni eroe in scena ha una zona; `si_sposta` la cambia (il proprietario
  valida l'adiacenza; più passi = più eventi). Ingresso nel luogo: zona d'ingresso.
- Dove esiste una mappa con pedine, la zona si ricava dalla pedina (raggruppando le caselle) e le
  distanze in caselle prevalgono.
- Il quadro dice dove sono tutti: "Sei al bordo nord. Al centro: Ioshua, Mairon, le gallette,
  il barile. A poppa: Amleth."

## 7. Sensi: regole di percezione

Per ogni osservatore O ed evento E nello stesso luogo:

| Canale | O percepisce E se | Degrado |
| --- | --- | --- |
| Vista | O cosciente e sveglio, occhi liberi; luce sufficiente (giorno, o fonte di luce nella zona, o scurovisione); distanza ≤ visibilità meteo (chiara: tutto il luogo; scarsa: adiacente; nulla: stessa zona) | se `covert`: solo se Percezione passiva di O ≥ `stealth` |
| Udito | O cosciente (il sonno sente solo `shout`/`noise`, e si sveglia); `whisper`: stessa zona; `normal`: adiacente, o stessa zona con burrasca; `shout`/`noise`: tutto il luogo | sordità, vento forte riduce di un passo |
| Tatto | O è in `targets` di un verbo fisico (spinge, afferra, colpisce, tocca, abbraccia, lega, da in mano) | sempre, anche addormentato (e si sveglia) |
| Odore/gusto | O nella stessa zona di un oggetto con odore (tag) o mangia/beve | — |

- **Percezione passiva** = 10 + mod. Saggezza + competenza in Percezione dal foglio del cast,
  −5 per ciascun moodle ≥3 di sonno, sfinimento o dolore, −5 al buio senza luce (regole D&D:
  svantaggio = −5 al passivo).
- Un evento visto **senza** sentire le parole: "Mairon parla a Ottone, troppo lontano per capire".
  Sentito senza vedere: "una voce, al buio, dice: «…»" (il nome solo se O conosce la voce, cioè la
  persona).
- **Attenzione**: O tiene al massimo N=8 eventi per turno, in quest'ordine: fatti a lui → sui suoi
  oggetti o legami forti → `shout`/`noise` → stessa zona → resto. Quelli esclusi non sono percepiti
  (né memoria, né appraisal).
- **Apparenza, non interiorità**: degli altri vede i moodle ≥3 come segni ("trema", "barcolla",
  "si stringe lo stomaco"), le condizioni visibili (legato, ferito, a terra), cosa tiene in mano.
  Mai "ha fame".

## 8. Corpo (moodle, alla Project Zomboid)

| Moodle | Fonte | Livelli 0–4 (soglie indicative) | Effetto |
| --- | --- | --- | --- |
| Sete | ore da `drankAt` | 8 / 16 / 24 / 36 h | −1/−2/−3/−5 alle prove; 4: sfinimento +1 al giorno |
| Fame | ore da `ateAt` | 12 / 24 / 48 / 72 h | idem, più lento |
| Sonno | ore da `sleptAt` | 16 / 20 / 24 / 36 h | −Percezione passiva, 4: si addormenta |
| Sfinimento | livelli D&D | 1–4 | regole D&D |
| Freddo | meteo × esposizione × bagnato × coperte | 4 livelli | 3+: ipotermia, danno |
| Bagnato | pioggia, onde, immersione; asciuga col tempo | 4 livelli | aggrava il freddo |
| Dolore | ferite (`condition`, PF del cast) | 4 livelli | −prove, −Percezione |
| Nausea | cibo guasto, mare grosso | 4 livelli | rifiuta il cibo |

- Nuovi campi in `NpcState`: `sleptAt`, `wet`, `cold`, `nausea`, `exhaustion` (gli altri derivati).
  Scrive solo il proprietario `cast`, aggiornati a ogni avanzamento d'orologio e a ogni evento
  d'ambiente.
- Combinazioni fisse: bagnato ≥2 + freddo ≥2 + vento → freddo +1 per ora.
- **Oggetti che pubblicizzano** (The Sims): tag `serve: sete|fame|freddo|sonno|dolore` per
  catalogo e per nome (barile d'acqua → sete; galletta, pesce → fame; coperta → freddo). Per ogni
  moodle ≥2 il quadro nomina gli oggetti visibili che lo servono, con zona e proprietario
  ("di nessuno", "di Kaku").

## 9. Animo (moodlet, alla The Sims)

### 9.1 Stato

```ts
type Moodlet = { npcId: string; emotion: Emotion; weight: number; source: string;
                 toward?: string; eventId?: string; startedAt: number; expiresAt: number };
type Emotion = "paura" | "rabbia" | "tristezza" | "vergogna" | "gratitudine" | "speranza"
             | "disgusto" | "sollievo" | "noia" | "panico" | "affetto" | "gelosia";
```

- Il peso decade linearmente fino a `expiresAt`. Lo stesso `source`+`toward` non si somma: si
  rinnova e prende il peso maggiore (anti-spirale).
- **Umore** = somma per emozione; **dominante** = la più alta se ≥ 15. La mente riceve dominante e
  le due seguenti, in parole, con la causa: "Sei furioso con Ottone: ti ha rubato la ciotola.
  Hai paura del mare."

### 9.2 Appraisal (da dove nascono)

1. **Tabella fissa** per i verbi chiari, vista da O secondo il suo ruolo nell'evento:

| Evento | O è il bersaglio | O lo vede, legame + con bersaglio | O lo vede, neutro |
| --- | --- | --- | --- |
| colpisce | paura 30 + rabbia 30 verso attore, 4 h | rabbia 20 verso attore | paura 10 |
| ruba/prende a O | rabbia 35 verso attore, 6 h | rabbia 15 | disgusto 10 |
| da/aiuta/cura a O | gratitudine 30 verso attore, 12 h | affetto 5 | — |
| lega | paura 40, rabbia 30 | rabbia 20 | paura 10 |
| minaccia | paura 25 | paura 10 | — |
| mangia davanti a O affamato | — | — | gelosia/rabbia 10 × livello fame |
| vede un morto | — | tristezza 50 | paura 30 |

2. **Corpo → animo**: fame ≥3 → rabbia 10; freddo ≥3 → panico 10; sonno ≥3 → tristezza 10;
   tempesta → paura 10 (rinnovati ogni ora finché dura la causa).
3. **Ambiguo → lettore "Io"**: parole (`parla`, `grida`, `sussurra`) e `altro`. Una chiamata breve
   per evento percepito con parole rivolte a O o su O, con lista chiusa:
   `{ tipo: insulto|minaccia|lusinga|richiesta|promessa|bugia_scoperta|conforto|scherno|nulla,
   colpa: nome|"", intensità: 1|2|3 }` → tabella fissa come sopra. Una risposta non valida =
   `nulla`.
4. **Tratti** dal temperamento (`NpcPersonality`): `composure` bassa → pesi ×1,5, alta → ×0,5;
   `boldness` alta converte metà della paura in rabbia, bassa la rabbia in paura; `warmth` alta
   ×1,5 su gratitudine e affetto; `empathy` alta: emozioni del bersaglio passano all'osservatore a
   metà peso.

### 9.3 Effetti

- Panico, rabbia o paura ≥ 60 → la mente riceve la stessa spinta che oggi dà l'urgenza dei bisogni
  ("non puoi restare fermo: agisci").
- Umore → modificatore delle prove sociali verso chi è causa (rabbia verso X: −2 a farsi
  persuadere da X; gratitudine: +2).
- La mente può **reprimere**: se nel "PENSA" dice di trattenersi, il moodlet resta (lo stato è del
  server), cambia solo l'azione.

## 10. Legami

- Tabella `npc_bonds`: `{ npcId, toward (PNG o eroe), trust, affection, fear (−100..100),
  reasons: string[] (ultime 3) }`. Sostituisce l'uso di `agency.relations`; `relationships`
  (PNG→eroe, meter visibile ai giocatori) resta la fonte per gli eroi e viene aggiornata dalle
  stesse regole.
- Aggiornati **solo da eventi percepiti** con tabella fissa (colpito da X: fiducia −20, paura +15;
  ricevuto cibo: fiducia +10, affetto +10; bugia scoperta: fiducia −25). Non decadono.
- Nel quadro: solo le persone presenti o nominate, in parole e con le ragioni: "Ottone: non ti
  fidi (ti ha rubato la ciotola), ne hai un po' paura."

## 11. Conoscenze e storia propria

- **Memoria per evento**: ogni evento percepito diventa una riga `perceived` con
  `source_name = "on stage"` e un campo `importance` (0–3: fatto a me 3, legami forti 2, forte
  2, resto 1). Mai più copie di prosa.
- **Credenze**: ciò che arriva per `npc_inform` o per parole di altri su fatti non visti resta
  `belief` con la fonte. Un fatto visto che contraddice una credenza la marca falsa e genera
  `bugia_scoperta` verso la fonte.
- **Selezione nel prompt**: background sempre; poi per importanza e recenza fino a 40; le proprie
  azioni chiave (`self` con importanza ≥2: giuramenti, colpi dati, furti, promesse) restano come
  **storia propria**.
- **Nomi**: invariato (`knowsName`).

## 12. Il Quadro percettivo (prompt della mente)

Ordine fisso, ogni sezione vuota omessa:

1. Chi sei (identità, temperamento, obiettivi) e **storia propria**.
2. **Dove sei e quando**: luogo, la tua zona, chi e cosa c'è in ogni zona, ora, luce, cielo,
   quanto tempo è passato dal tuo ultimo turno.
3. **Il tuo corpo**: moodle ≥1 in parole, più forte prima; oggetti visibili che li servono.
4. **Cosa provi**: dominante + due, con causa.
5. **Le persone qui**: aspetto visibile, cosa tengono in mano, e il tuo legame con ciascuno.
6. **Cosa hai percepito dal tuo ultimo turno**, per canale e in ordine di tempo: "Hai visto…",
   "Hai sentito…", "Hai sentito sul corpo…". Comprende gli esiti di tutti gli altri PNG del turno
   precedente che hai percepito.
7. **Atmosfera** (D1): al massimo 300 caratteri della narrazione del turno, marcati "come lo
   racconta il narratore, impressione", mai salvati in memoria.
8. Ricordi (selezionati come in §11).
9. La richiesta di turno (invariata: DICE, FA, PENSA, MENTE).

Lo stesso quadro, senza emozioni e legami, va all'**arbitro del palco** (zone, luce, meteo, chi
tiene cosa, moodle visibili) e all'**"Io"**.

## 13. Il turno, aggiornato

1. Righe degli eroi → eventi `parla` + posizione.
2. Arbitro del master → comandi ai proprietari → eventi.
3. **Palco**: per ogni PNG il Quadro (eventi percepiti dal suo ultimo turno); voci in parallelo;
   arbitro del palco in ordine → eventi strutturati (ciascuno vede gli eventi già decisi in questo
   turno nei `facts`, come oggi).
4. Interprete degli oggetti → proprietario Oggetti → eventi.
5. **Dopo tutti gli eventi del turno**: per ogni PNG in scena, Sensi → percepiti → memoria,
   appraisal (moodlet), legami. Corpo aggiornato all'orologio.
6. Narratore: racconta dagli esiti (invariato).

Così ogni PNG al turno N+1 conosce, per i suoi sensi, tutto ciò che è accaduto al turno N,
compresi gli altri PNG. Il bug §1.3 sparisce per costruzione.

## 14. Dati

Tabelle nuove (in `src/lib/db/core.ts`, `CREATE TABLE IF NOT EXISTS`):

- `scene_events(id, campaign_id, turn_id, instant, place, actor, verb, targets_json, object,
  zone_from, zone_to, volume, covert, stealth, success, speech, outcome, created_at)`
- `place_zones(campaign_id, place, zones_json)`; colonna `zone` su `npcs`; posizione eroi in
  `character_positions(campaign_id, sheet_id, place, zone)`.
- `npc_moodlets(id, campaign_id, npc_id, emotion, weight, source, toward, event_id, started_at,
  expires_at)`
- `npc_bonds(campaign_id, npc_id, toward, trust, affection, fear, reasons_json, updated_at)`
- `npc_memories`: colonna `importance INTEGER DEFAULT 1`, `event_id TEXT DEFAULT ''`.

Annullare un turno (`retract`, `turn-revert`) cancella eventi, moodlet, legami e memorie con quel
`turn_id`/`event_id`: ogni scrittura porta il turno.

### Dati esistenti

- Le memorie `perceived` già salvate restano (nessuna migrazione distruttiva); la selezione per
  importanza le mette in fondo (importanza 1, le copie di prosa vengono superate dagli eventi).
- Campagne senza `npcMinds`/`npcStage`: nessun cambiamento.
- `everyoneHears` viene sostituito dagli eventi `parla` (fetta 2); fino ad allora resta.

## 15. Modelli e costo

- Nessuna nuova chiamata per percezione, corpo, legami: tutto calcolo.
- Nuove chiamate: generazione zone (una per luogo, una volta); appraisal delle parole ambigue
  (≤ una per evento parlato rivolto a un PNG, raggruppate per osservatore in una sola chiamata per
  turno). Modello: quello dell'"Io".
- Prompt della mente: il quadro sostituisce narrazione lunga e copie di prosa; atteso più corto
  di oggi.

## 16. Errori e limiti

- Arbitro senza campi strutturati → evento `altro` con `targets` vuoti, volume `normal`: percepito
  solo per vista/udito, nessun appraisal da tabella (resta l'appraisal ambiguo).
- Zone non generate → una sola zona (tutto il luogo): vista e udito come oggi, il resto funziona.
- Appraisal ambiguo non valido → nessun moodlet.
- Foglio del cast assente → Percezione passiva 10.

## 17. Decisioni

- **D1** Narrazione: solo come atmosfera ≤300 caratteri, non salvata. *(proposta adottata;
  modificabile)*
- **D2** Zone generate dal server per luogo; pedine quando c'è la mappa. *(proposta adottata)*
- **D3** Emozioni ibride: moodlet tenuti dal server, tabella per azioni chiare, "Io" su lista
  chiusa per l'ambiguo. *(proposta dall'utente: "meglio modello?"; questa è la risposta concordata
  in chat, da confermare)*
- **D4** Furtività: Percezione passiva contro il tiro dell'attore. *(proposta adottata)*
- **D5** Attenzione: massimo 8 eventi per turno per PNG. *(scelta tecnica, tarabile)*

Domande aperte: soglie dei moodle e pesi delle tabelle sono indicativi; si tarano sulla Zattera
(fetta 8).

## 18. Fette di implementazione

Ogni fetta: test unitari della logica pura, test d'integrazione in `scripts/test-npc-stage.mjs`
(o una suite nuova `scripts/test-npc-perception.mjs`), `tsc`, eslint, PR, merge, deploy, 3–5 turni
sulla Zattera.

1. **Eventi minimi e memoria per evento.** `scene_events`; l'arbitro restituisce `verb`,
   `targets`, `object`, `volume`; esiti del palco salvati come eventi; dopo il palco tutti i
   presenti ricevono come memoria ogni evento (bug §1.3); narrazione non più salvata come memoria
   (`handleNpcSpeak` dal palco); quadro §12 punti 2, 6, 7. *Accettazione: con 7 PNG, al turno
   successivo ognuno ha in "Cosa hai percepito" gli esiti degli altri 6.*
2. **Righe degli eroi e proprietari come eventi**; `everyoneHears` sostituito. *Accettazione: un
   oggetto preso da terra da Kaku è percepito da tutti come evento, non da prosa.*
3. **Zone e posizioni**, filtri di vista e udito, sussurro. *Accettazione: un sussurro al bordo
   nord non arriva a poppa; nella tempesta "normal" arriva solo nella stessa zona.*
4. **Corpo**: moodle, meteo/esposizione, sonno, oggetti che pubblicizzano. *Accettazione: con fame
   ≥2 il quadro nomina le gallette a terra con la zona; bagnato + freddo salgono nella burrasca.*
5. **Legami** PNG↔PNG con ragioni. *Accettazione: dopo un furto visto, il derubato ha fiducia
   negativa verso il ladro con la ragione.*
6. **Animo**: moodlet, tabella, tratti, decadimento, appraisal ambiguo. *Accettazione: il
   derubato è "furioso con X" per alcune ore, poi cala; un insulto valutato produce rabbia.*
7. **Furtività** con Percezione passiva. *Accettazione: un furto nascosto con tiro 15 è percepito
   solo da chi ha passiva ≥15.*
8. **Memoria per importanza, storia propria, taratura** su 10+ turni Zattera; vista di debug del
   quadro di un PNG per il master.

## 19. Verifica

- **Unit (puri)**: `senses-logic` (ogni filtro), `moodles-logic` (soglie, combinazioni),
  `mood-logic` (tabella, tratti, decadimento, non-cumulo), `bonds-logic`, `zones-logic`
  (validazione), `perception-frame-logic` (stessi input → stesso testo).
- **Integrazione**: palco con modello finto: 7 PNG, eventi incrociati, buio, tempesta, sussurro,
  furto nascosto, annullamento del turno (eventi, moodlet, legami, memorie rimossi).
- **Live (Zattera osservatore)**: i PNG reagiscono a ciò che hanno fatto gli altri; chi ha fame
  prende cibo a terra; un furto nascosto è notato solo da alcuni; le emozioni durano e calano;
  nessuna copia di prosa nuova nelle memorie. Non ancora eseguito.
- **Manuale**: lettura dei quadri di 2–3 PNG per turno per coerenza.
