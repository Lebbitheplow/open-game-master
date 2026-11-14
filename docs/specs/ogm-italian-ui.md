# Interfaccia in italiano, compatibile con il catalogo di ziomik

## Artifact Graph
- Artifact ID: `spec:ogm-italian-ui`
- Role: spec
- Parent: [Evoluzione di Open Game Master](open-game-master-evolution-wayfinder.md)

## Type
Feature

## Gates
- Attempt: il lavoro fino al passaggio di consegna (merge nel fork).
- Budget, tempo, tentativi massimi: nessuno impostato.
- Approvazioni: merge nel fork già autorizzato dall'utente. Le bozze di traduzione usano il
  piano Codex già in uso, senza spesa aggiuntiva; nessuna pubblicazione upstream.
- Versione esatta: nessuna.
- Blocchi trovati: nessuno. Cercati `CONTRIBUTING.md` (non parla di traduzioni), l'issue
  upstream #919 e i test `name-lookups` e `text-comparisons`, che classificano ogni nuovo
  confronto di testo: lo strato di traduzione confronta testo dell'interfaccia, non nomi di
  record, e va classificato.

## Decisioni dell'utente
- L'interfaccia deve essere in italiano (2026-11-14).
- Metodo: catalogo con il testo inglese come chiave, **compatibile con quello di ziomik**
  (issue #919), applicato da uno strato separato dai componenti.
- Lo strato sta **dentro l'app**, non in un proxy; la lingua è un'impostazione personale.
- In implementazione la scelta è salvata **sul dispositivo**, come tema e scala nella stessa
  sezione Aspetto, invece che nel profilo: nessun cambio a server o API.

## Fatti
- Nessun sistema di traduzione nell'app; `src/app/layout.tsx` ha `lang="en"` fisso.
- ziomik (issue #919, 2026-11-13) descrive: catalogo `{"English text": "Testo italiano"}`
  di ~45.800 voci; uno script nel browser sostituisce il testo visibile e gli attributi
  `title`, `placeholder`, `aria-label`, `alt` che corrispondono **esattamente** a una voce;
  narrazione, chat e nomi dei giocatori restano intatti; ciò che manca resta in inglese.
  A ogni release estrae le stringhe statiche (12.331 su 0.34.3), le confronta col catalogo e
  traduce solo le nuove con un glossario 5e. Il catalogo non è pubblico; gli è stato chiesto
  nell'issue (commento 6880574982), senza risposta finora.
- Il maintainer upstream vuole a lungo termine `t("English")` (gettext) con lingua dal
  browser e scelta nelle impostazioni personali. Un catalogo con chiavi inglesi può
  alimentarlo.
- Le impostazioni personali passano da `src/app/api/profile/route.ts` (`settingsSchema`) e
  `getUserSettings`/`updateUserSettings`; la pagina è `src/app/settings`.
- I nomi SRD italiani ufficiali esistono già: `src/lib/language/srd-names-it.json`.

## Comportamento atteso
1. In Impostazioni c'è «Lingua dell'interfaccia»: Automatica (dal browser), English, Italiano.
   Automatica sceglie l'italiano quando la lingua preferita del browser inizia per `it`.
   La scelta è salvata su questo dispositivo (`localStorage`, come il tema); cambiarla
   ricarica la pagina.
2. Con l'italiano attivo, ogni testo visibile dell'interfaccia e ogni `title`, `placeholder`,
   `aria-label`, `alt` che corrisponde esattamente (dopo aver tolto gli spazi ai bordi) a
   una voce del catalogo viene mostrato in italiano, anche quando React lo cambia o lo
   aggiunge dopo. `<html lang>` diventa `it`.
3. Non vengono mai toccati: narrazione, chat, sussurri, nomi di personaggi e giocatori, testo
   scritto dall'utente, valori dei campi, `contenteditable`, codice. Ogni zona del genere ha
   `translate="no"` (l'attributo HTML standard); lo strato salta l'intero sottoalbero.
4. Testo senza voce resta in inglese; nessun errore, nessun segnaposto.
5. In inglese (o Automatica con browser non italiano) l'app è identica a oggi: il catalogo
   non viene nemmeno scaricato.
6. Testo costruito al volo (es. «Kara, their turn»): un secondo file opzionale di modelli
   (`{"{name}, their turn": "{name}, è il suo turno"}`) separato dal catalogo, così il
   catalogo resta nel formato di ziomik.

## Perché un'impostazione (AGENTS.md, «Settings, options and toggles»)
Il predefinito Automatica basta a quasi tutti: chi ha il browser in italiano vede l'italiano.
Senza scelta, chi ha il browser in italiano ma preferisce l'interfaccia inglese originale (o
il contrario, su un dispositivo condiviso) non avrebbe alternative. Sta solo nelle
Impostazioni personali, mai nella creazione della campagna; un solo selettore.

## Righe di sistema della cronaca
Le righe che il server scrive da sé (turni, zaino del gruppo, veleni, tempo che passa)
nascono in `src/lib` e spesso uniscono più frasi. L'estrattore legge anche `src/lib/dm`,
`src/lib/workshop` e `src/lib/campaign-types.ts` (esclusi prompt e definizioni degli
strumenti, che il giocatore non vede) e le elenca **frase per frase**, togliendo le parti
variabili che stanno per un'altra frase. Nella pagina, gli elementi con
`data-ui-sentences` (riga di sistema, negozio aperto, patto rivelato) provano prima la riga
intera, poi ogni frase; quelle senza voce restano in inglese. Note del capogruppo e
riepilogo «Previously» sono testo di persone o del modello: `translate="no"` (l'etichetta
«Capogruppo:» sì, è dell'interfaccia). Regole del lettore di pattern:
- vince il pattern con più parole fisse;
- uno slot attaccato a una parola o a un altro slot può essere vuoto (`act{s}`);
- uno slot che contiene prosa (più parole minuscole, una fine di frase) va tradotto a sua
  volta, intero o frase per frase; altrimenti il match cade e la frase resta in inglese;
- una frase non si taglia dentro parentesi.

- nelle righe del server, uno slot che è un nome (o una lista di nomi) prende il nome
  ufficiale dell'SRD italiano quando ne ha uno solo (`italianName` in
  `src/lib/language/srd-names-it.ts`: «Scimitar» → «Scimitarra», «Bandit 2» → «Bandito 2»,
  «Longsword +1» → «Spada lunga +1»); «and»/«or» della lista prendono la congiunzione del
  pattern `{value} and {value2}` del catalogo («e»). Il resto dell'interfaccia non cambia i
  nomi.

## Contratti
- `src/lib/language/ui-it.json`: oggetto piatto `{"English text": "Testo italiano"}`, il
  formato di ziomik. Un suo catalogo si copia così com'è; le nostre voci funzionano col suo
  proxy. Una voce è inglese esatta, senza spazi ai bordi.
- `src/lib/language/ui-it.patterns.json`: `{"English with {name}": "Italiano con {name}"}`;
  segnaposto `{parola}` che corrispondono a qualunque testo non vuoto e vengono ricopiati.
- Chiave `localStorage` `odm.ui-language`: `"english" | "italian"`, assente = Automatica.

## Invarianti
- Lo strato cambia solo `nodeValue` di nodi di testo e valori di attributi: mai aggiunge,
  sposta o rimuove nodi, così React continua a possedere il DOM.
- Lavora dopo l'idratazione (prima del paint, in un layout effect) e poi con un
  `MutationObserver`; un testo che React riscrive in inglese viene ritradotto.
- Le chiamate agli strumenti, i dati salvati e le API restano in inglese.
- I termini di D&D nel catalogo usano i nomi ufficiali di `srd-names-it.json`.

## Modi di guasto
- Catalogo non scaricabile: interfaccia in inglese, nessun errore visibile.
- Una traduzione più lunga che rompe il layout: si corregge la voce, non il componente.
- Ciclo osservatore/React: lo strato ignora le mutazioni che ha prodotto lui stesso.

## Fasi
1. **Strato e impostazione**: componente client nel layout, catalogo, modelli, scelta in
   Impostazioni → Aspetto, `translate="no"` sulle zone escluse, `lang` del documento.
2. **Estrattore**: `scripts/extract-ui-strings.mjs` legge `src/app` e `src/components` con il
   compilatore TypeScript ed elenca i testi JSX e gli attributi stringa traducibili; `--check`
   dice quante voci mancano nel catalogo, `--missing` le elenca.
3. **Catalogo**: bozza italiana delle voci mancanti in lotti con il glossario dei nomi
   ufficiali (Codex sul piano esistente), revisione dei termini di gioco, unione del catalogo
   di ziomik se lo condivide (le sue voci hanno precedenza su quelle generate).

## Verifica
- Unit: corrispondenza esatta, spazi ai bordi, attributi, salto di `translate="no"`, modelli,
  assenza di cicli, nessun nodo aggiunto o rimosso.
- Scelta: Automatica segue il browser; valore non valido ignorato.
- Estrattore: su un file di prova trova testo JSX e attributi, ignora classi e chiavi.
- Live: pagina della campagna in italiano; narrazione e nomi restano originali; tornando a
  English l'app è come prima.
- Copertura: `extract-ui-strings --check` riporta la quota tradotta.

## Limiti noti
- Una parola minuscola isolata o un articolo spezzati dal markup non si traducono, per non
  mescolare le lingue in una frase.
- Al primo caricamento completo della pagina l'inglese può comparire per un istante.

## Non obiettivi
- Convertire i componenti a `t()` (gettext): lasciato a upstream.
- Tradurre descrizioni delle regole, testo dei pacchetti, narrazione.
- Altre lingue oltre all'italiano (il formato le permette).
