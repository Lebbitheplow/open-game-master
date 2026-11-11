// Undead Thralls (School of Necromancy 6): "You learn animate dead, raise one
// extra corpse per casting, and undead you create with a necromancy spell gain
// your wizard level in extra hit points and add your proficiency bonus to
// weapon damage."
//
// The server makes the skeleton itself (summon-cast.ts castSummon), so the
// feature is applied where the creature is made. Before this module the row
// was narrated ("the GM writes those onto their stat blocks") and Animate
// Dead raised one creature at its stat block's numbers whoever cast it.
//
// Called by summon-cast.ts castSummon (the spell's budget before it is
// planned, the form before it is recorded and spawned) and by the summons
// route (src/app/api/campaigns/[campaignId]/summons/route.ts), so the picker
// offers a holder the number the cast will take. Pure: no database.
//
// Rulings:
//   - "one extra corpse per casting" raises the casting's budget by one at
//     every slot level (a 3rd-level slot raises two, a 4th four), of either
//     form, and a casting that reasserts control holds no more than the spell
//     says: the feature speaks of raising.
//   - "weapon damage": every attack in the stat blocks Animate Dead and
//     Create Undead make is a weapon attack (a skeleton's shortsword and
//     shortbow, a zombie's slam, a ghoul's claws and bite, a wight's life
//     drain, a mummy's rotting fist are each printed "Weapon Attack"), so the
//     bonus joins each attack's own damage roll once; dice of another type
//     that ride a hit (the mummy's necrotic) are not a second roll for it.
//   - "your wizard level" is the holder's level in the class that gives the
//     feature; the proficiency bonus is the character's own.

import type { CharacterSheet } from "@/lib/schemas/sheet";
import { proficiencyBonus } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import type { SummonForm } from "@/lib/srd/summon-forms";
import type { SummonSpell } from "@/lib/srd/summon-spells";
import { containsPhrase, textKey } from "@/lib/language/text-logic";

type Holder = Pick<CharacterSheet, "level"> & Parameters<typeof activeAuthored>[0];

// The spell as this caster casts it: one more creature per casting where a
// feature says so. The same object for everybody else.
export function thrallSpell(caster: Holder, spell: SummonSpell): SummonSpell {
  const extra = activeAuthored(caster, "summon_extra")
    .filter(({ effect }) => textKey(effect.spell) === textKey(spell.name))
    .reduce((sum, { effect }) => sum + effect.amount, 0);
  return extra > 0 && spell.base !== undefined ? { ...spell, base: spell.base + extra } : spell;
}

// The form as this caster's spell makes it: sturdier and harder hitting where
// a feature says so, with the line for the result. Null for everybody else.
export function thrallForm(caster: Holder, spell: Pick<SummonSpell, "school">, form: SummonForm): { form: SummonForm; note: string } | null {
  for (const { effect, held } of activeAuthored(caster, "summon_thrall")) {
    if (textKey(effect.school) !== textKey(spell.school) || !effect.types.some((type) => containsPhrase(form.type, type))) {
      continue;
    }
    const hp = Math.max(1, held.level);
    const bonus = proficiencyBonus(caster.level);
    return {
      form: { ...form, hp: form.hp + hp, attacks: form.attacks.map((attack) => ({ ...attack, damage: `${attack.damage}+${bonus}` })) },
      note: `${held.feature}: ${hp} more hit points each, and +${bonus} on their weapon damage.`,
    };
  }
  return null;
}
