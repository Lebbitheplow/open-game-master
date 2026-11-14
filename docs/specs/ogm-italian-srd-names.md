# Nomi italiani ufficiali delle regole

## Artifact Graph
- Artifact ID: `spec:ogm-italian-srd-names`
- Role: spec
- Parent: [Evoluzione di Open Game Master](open-game-master-evolution-wayfinder.md)

## Type
Feature

## Context
A un tavolo con *Table language* italiano il narratore scrive in italiano, ma i nomi delle
cose di regola (incantesimi, mostri, oggetti, condizioni…) li traduce da solo: possono
cambiare da un turno all'altro e non coincidere con quelli dei manuali italiani.
Il motore riconosce le cose solo dal nome inglese (`srdName`, `itemRow`): un oggetto
chiamato «Spada lunga» senza `srdName` non viene riconosciuto come Longsword.
Ricerca: [ogm-italiano.md](../research/ogm-italiano.md).

## Decisions (utente, 2026-11-14)
- Tradurre **tutti i nomi** che compaiono nell'SRD 5.1 italiano ufficiale: incantesimi, mostri,
  oggetti, armi e armature, oggetti magici, condizioni, abilità, classi, razze.
- I nomi servono **al narratore e al riconoscimento**: il narratore usa i nomi ufficiali, e il
  gioco riconosce un nome italiano ufficiale come la cosa inglese corrispondente.
- **Nessuna descrizione** tradotta: servono solo al narratore, che legge le regole in inglese.
- Le schermate (scheda, elenchi) restano fuori: appartengono al lavoro sull'interfaccia.

## Target behavior
1. **Dati.** Un elenco inglese → italiano, ricavato dall'SRD 5.1 italiano ufficiale di Wizards
   of the Coast (CC BY 4.0, `SRD_CC_v5.1_IT.pdf`) confrontando le voci con quelle inglesi del
   gioco. Ogni coppia ha una categoria. Lo script che lo genera è nel repository e ripetibile;
   il file generato porta la dichiarazione di attribuzione richiesta dalla licenza.
2. **Narratore.** A un tavolo italiano, ogni chiamata che scrive per i giocatori riceve, accanto
   alla direttiva di lingua, un glossario limitato ai nomi di regola presenti nel suo prompt
   («Magic Missile → Dardo incantato»). La direttiva esistente resta: valori e nomi che il gioco
   confronta esattamente restano in inglese negli argomenti degli strumenti.
3. **Riconoscimento.** Dove il gioco cerca un oggetto per nome (`itemRow`, `srdNameFor`), un
   nome italiano ufficiale intero trova la stessa riga del nome inglese. Solo nomi interi,
   come per l'inglese: «Spada» non è «Spada lunga».
4. Tavoli in altre lingue e tavoli inglesi: nessun cambiamento.

## Invariants
- Il motore legge le regole sempre dalla riga inglese; il nome italiano è solo un altro modo di
  trovarla.
- Un nome italiano ambiguo (due cose inglesi diverse con lo stesso nome italiano) non viene
  riconosciuto: si comporta come un nome sconosciuto.
- Nessun nome inventato: solo coppie ricavate dal documento ufficiale e controllate.

## Non-goals
Descrizioni, testi delle regole, interfaccia, contenuti del pacchetto Open5e che non sono
nell'SRD 5.1, nomi della 5e 2024.

## Verification
- Script/unit: il generatore produce coppie per ogni categoria; ogni nome inglese esiste nei
  dati del gioco; nessun nome italiano duplicato non segnalato; conteggi riportati.
- Controllo indipendente: confronto a campione con una traduzione italiana esterna,
  solo come verifica (non copiata: priva di licenza).
- Unit: glossario per prompt (solo nomi presenti, nessuno per tavoli non italiani);
  `itemRow`/`srdNameFor` con nomi italiani, nomi parziali rifiutati.
- Manuale: un turno reale a un tavolo italiano usa un nome ufficiale.

## Gates
- Attempt: il lavoro fino al passaggio di consegna.
- Budget, tempo, tentativi massimi: nessuno impostato.
- Approvazioni: merge nel fork già autorizzato dall'utente; nessuna spesa esterna richiesta
  (un turno di prova usa il piano Codex già in uso).
- Versione esatta: nessuna.
- Blocchi trovati: nessuno (cercati AGENTS.md, CONTRIBUTING, test name-lookups e text-comparisons,
  che classificano ogni nuova ricerca per nome).
