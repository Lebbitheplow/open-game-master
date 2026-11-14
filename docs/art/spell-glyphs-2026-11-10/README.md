# Spell glyphs, 10 November 2026

Spell cards in the Hand show one glyph for what the spell mainly does,
instead of a painting per spell (issue
[#845](https://github.com/Lebbitheplow/open-game-master/issues/845)). The
glyph is the spell's lead damage type, or else its effect:

- **Damage (11):** acid, cold, fire, force, lightning, necrotic, physical
  (a sword: bludgeoning, piercing and slashing), poison, psychic, radiant,
  thunder.
- **Effect (10):** heal, restore (ends a condition or a curse), guard,
  dispel (ends a spell), buff, debuff, summon, teleport, detection, utility.
- **choice:** the caster, or a die, picks the damage type as the spell is
  cast (Chromatic Orb, Dragon's Breath, Chaos Bolt).
- **unknown:** nobody has said what the spell does yet (a workshop spell
  with no block of its own, a pack spell the reader could not place).

Which spell gets which glyph is in
`src/lib/battlemap/spell-glyph-logic.ts` (read from the engine's mechanics
row) and `src/lib/battlemap/spell-glyph-names.ts` (the spells the row does
not settle). `scripts/test-spell-glyphs.mjs` holds both.

## Files

The 23 glyphs ship as `public/assets/icons/glyph/spell-<glyph>.webp`.
[provenance.json](provenance.json) records, for each one, who drew it,
where the approved file came from, its SHA-256 before and after (they
match: every file ships byte for byte as approved), its size, and the Codex
prompt and style references where one was used.

- **grokbot** drew the first set (acid, cold, fire, force, lightning,
  radiant, thunder, buff, and the shield that became guard). His originals,
  mapping and proposal are on the fork branch
  `Smoebo/open-dungeon-master:art/spell-glyph-proposal`.
- **Codex** redrew necrotic (a skeletal hand), poison (skull and
  crossbones), psychic (a head with rings), physical (a sword), utility (an
  open hand holding light), heal (a red heart with a green cross) and
  teleport (a figure between two portals) after comparing each idea with
  how other games draw it, and painted the new restore, dispel, summon,
  detection, choice and unknown glyphs, with grokbot's buff and shield as
  the style reference.
- **Code recolours:** guard is grokbot's shield in silver; debuff is his
  buff flipped and recoloured purple.

[pairs.webp](pairs.webp) is the council's check of the pairs that could be
mistaken for each other, with a one-colour outline at 20px for colour-blind
players.

## Review

Albert, Claude, Codex and Grok reviewed the set in two rounds on issue 845
(round 2:
[comment](https://github.com/Lebbitheplow/open-game-master/issues/845#issuecomment-6758787273)).
The glyphs were checked at 52, 36 and 20px and on Hand cards at their real
sizes, by night and day. School is not on the card; it stays in the spell's
details and the spellbook filter.

Every place a spell is drawn wears its glyph: the Hand's cards, its More
sheet, arrange list and group cards, the sheet's spellbook (the builder's and
the level-up dialog's too), the party panel's concentration chip, the hero
tips and the workshop. Away from the Hand the glyph is read from
`src/lib/battlemap/spell-glyph-table.json`, which
`scripts/build-spell-glyph-table.mjs` writes from the Hand's own answers. The
per-spell paintings are no longer drawn for a spell, and after 0.35.0 the 508
that nothing drew were deleted (a run of every browser scenario, on the
website and in the app shell, asked for none of them). `public/assets/icons/spell/`
keeps the nine that class features still borrow as their icon (`ICON_ALIASES`
in `src/lib/icons.ts`), and `SPELL_PAINTINGS_WORN` in `scripts/icon-set.mjs`
paints only those, so a generator run never brings the rest back.
`scripts/test-icons.mjs` holds the folder, the manifest and the painted index
to the aliases.
