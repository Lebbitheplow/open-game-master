# Italiano nel fork: che cosa esiste e da dove partire

## Artifact Graph
- Artifact ID: `research:ogm-italiano`
- Role: research
- Parent: [Evoluzione di Open Game Master](../specs/open-game-master-evolution-wayfinder.md)

## Domanda
Qual è la strada per avere il fork interamente in italiano, sapendo che cosa fa già il codice,
che cosa ha deciso il maintainer upstream e che cosa hanno costruito il fork francese e il
tavolo italiano della #919? Osservato il 2026-11-14 su `main` del fork (`ef332b1db`) e su
upstream `044b9dcd0`.

## Answer
L'italiano si divide in tre parti, con stato molto diverso.

1. **La storia è già in italiano.** L'impostazione di campagna *Table language* include
   `italian`: il GM scrive in italiano e il server legge storia, messaggi, dettatura e voce
   in italiano. Serve però un modello di embedding multilingue sul server
   (`EMBEDDING_MODEL=Xenova/multilingual-e5-small`): il nostro `.env.server` non lo imposta,
   quindi oggi la ricerca nella memoria della campagna usa il modello inglese.
2. **I contenuti (regole, nomi di incantesimi, mostri, oggetti) sono in inglese.** Il motore
   legge le regole da `srdName` in inglese, mentre il nome mostrato può essere italiano. Il
   maintainer vuole come primo passo i nomi ufficiali come *overlay di dati* indicizzato per
   id SRD, più un secondo regolamento tradotto e contenuti in pacchetti.
3. **L'interfaccia è in inglese.** Nessuno l'ha ancora tradotta in un modo che upstream accetti.
   Il maintainer ha rifiutato il dizionario a chiavi del fork francese e chiede l'approccio
   gettext: testo inglese come chiave (`t("Loading…")`), estrattore, regola di lint, bozze
   tradotte automaticamente per le righe nuove; lingua dal browser con scelta nelle
   impostazioni personali. Il tavolo italiano della #919 usa invece un proxy esterno che
   sostituisce il testo visibile con un catalogo di circa 45.800 voci; non è pubblico.

## Evidence
- `src/lib/schemas/game-settings-options.ts` — `TABLE_LANGUAGES` include `italian`; il testo
  d'aiuto dice che app, regole e regolamento restano in inglese e che serve un embedding multilingue.
- `.env.example` righe 62–68 — `EMBEDDING_MODEL` commentato; consigliato
  `Xenova/multilingual-e5-small`, solo modelli a 384 dimensioni, cambio sicuro con
  re-embedding all'avvio. `.env.server` del fork non lo imposta.
- Campagna di prova «La locanda del ponte»: `tableLanguage = italian`.
- [Issue #919](https://github.com/Lebbitheplow/open-game-master/issues/919), aperta:
  - risposta del maintainer (2026-11-11): dizionario a chiavi rifiutato; ordine «contenuti
    prima, come dati», poi interfaccia gettext; chi traduce costruisce e mantiene estrattore,
    lint, bozze automatiche, codemod e PR dei contenuti; le release non aspettano la traduzione;
  - mcerina: `srdName` già separa nome mostrato e regole; propone la lingua decisa dal server
    (scelta salvata, cookie, poi `Accept-Language`), non da un header del client;
  - ziomik (2026-11-13): tavolo italiano con proxy davanti alla build invariata, catalogo
    inglese→italiano di ~45.800 voci, glossario 5e, 12.331 stringhe statiche estratte con
    copertura dichiarata al 100% su 0.34.3. Codice e catalogo non pubblicati: nessun repository
    pertinente tra quelli pubblici di `ziomik`.
- Fork francese `bkruggel/open-game-master`, branch `i18n-french`, fermo al commit `47045607`
  (2026-11-12): è la forma a chiavi che il maintainer ha rifiutato.
- Upstream ha 403 commit non presenti nel fork; nessuno introduce l'interfaccia tradotta
  (ricerca nei messaggi: french, locale, translat, i18n, language).
- Conteggio approssimativo: circa 5.850 stringhe distinte tra virgolette in `src/app` e
  `src/components`. È una stima grezza, inferiore alle 12.331 misurate da ziomik con un estrattore.

## Unknowns
- Se ziomik condividerebbe catalogo e glossario: è solo un'offerta nel thread, non verificata.
- Qualità effettiva della narrazione italiana su una sessione lunga con embedding multilingue:
  non provata qui.
- Tempi e forma della futura interfaccia gettext upstream: nessuno l'ha ancora iniziata.

## Next Step
Decisioni per l'utente, in ordine di costo:
1. Subito, solo configurazione: impostare l'embedding multilingue sul server di prova.
2. Allineare il fork a upstream prima di toccare migliaia di stringhe, per evitare conflitti
   con 403 commit.
3. Contenuti italiani come dati (nomi ufficiali per id SRD), la parte che upstream accetta.
   **Fatto** ([spec](../specs/ogm-italian-srd-names.md)): `src/lib/language/srd-names-it.json`,
   generato da `scripts/generate-it-srd-names.mjs` dall'SRD 5.1 italiano ufficiale; glossario
   per il narratore e riconoscimento degli oggetti per nome italiano intero.
4. Interfaccia: approccio gettext (allineato a upstream, costoso) oppure catalogo/proxy
   alla ziomik (rapido, fuori dal codice, non accettabile upstream).
