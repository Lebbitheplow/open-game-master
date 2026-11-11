// A warlock's Pact Boon at the table (SRD 5.1, warlock, Pact Boon), through
// use_resource with the boon's name (src/lib/dm/srd-feature-spends.ts):
//
//   Pact of the Blade
//   - "You can use your action to create a pact weapon in your empty hand.
//     You can choose the form that this melee weapon takes each time you
//     create it." variant names the form (a melee weapon of the table):
//     the action, a hand free for it, and a row marked as the pact's.
//   - "It also disappears if you use this feature again, if you dismiss the
//     weapon (no action required), or if you die." variant 'dismiss'.
//   - "You can transform one magic weapon into your pact weapon by performing
//     a special ritual while you hold the weapon. You perform the ritual over
//     the course of 1 hour, which can be done during a short rest. You can
//     then dismiss the weapon, shunting it into an extradimensional space,
//     and it appears whenever you create your pact weapon thereafter. The weapon
//     ceases being your pact weapon if you die, if you perform the 1-hour
//     ritual on a different weapon, or if you use a 1-hour ritual to break
//     your bond to it. The weapon appears at your feet if it is in the
//     extradimensional space when the bond breaks." variant 'bond <weapon>'
//     and 'break bond': an hour on the clock, never in a fight.
//
//   Pact of the Tome
//   - "If you lose your Book of Shadows, you can perform a 1-hour ceremony to
//     receive a replacement from your patron. This ceremony can be performed
//     during a short or long rest, and it destroys the previous book."
//     use_resource "Book of Shadows": an hour, a new book on the sheet, and
//     the old one gone wherever it lies.
//
// Which weapon is the pact weapon is read in src/lib/srd/pact-weapon.ts; the
// minute apart and a death are watched in mt-srd-pact.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { advanceClock } from "@/lib/db/clock";
import { getDmTurn } from "@/lib/db/dm-turns";
import { insertDroppedItem, listDroppedItems, takeFromDroppedItem } from "@/lib/db/dropped-items";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { priceTheAction } from "@/lib/dm/combat-features";
import { placeName, standing } from "@/lib/dm/gear-ground";
import { holdIfFree, inHand, weaponRowOf } from "@/lib/dm/gear-hands";
import { saveEquipment } from "@/lib/dm/gear-store";
import { asPactWrite, BOOK_OF_SHADOWS, conjuredMark, isBookOfShadows, PACT_APART, tomeMark, vanishStrays } from "@/lib/dm/mt-srd-pact";
import { handedOverRow } from "@/lib/dm/mutation-math";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { lineNamed, magicItemBonus } from "@/lib/srd/item-row";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { chosenOptions } from "@/lib/srd/options";
import { holdsPactOfTheBlade } from "@/lib/srd/pact-weapon";
import { matchWeapon } from "@/lib/srd/weapons";

const DISMISS = new Set(["dismiss", "dismissed", "dismiss it", "end", "release"]);
const BREAK = new Set(["break bond", "break the bond", "unbond", "break"]);
const RITUAL_MINUTES = 60;

const inFight = (campaign: Campaign) => {
  const encounter = getActiveEncounter(campaign.id);
  return encounter && (encounter.kind ?? "fight") === "fight" ? encounter : null;
};

// The equipment written with the audit trail a gear change has, as the
// feature's own write (mt-srd-pact.ts asPactWrite).
function write(campaign: Campaign, turnId: string, sheet: CharacterSheet, equipment: EquipmentItem[], delta: Record<string, unknown>, reason: string) {
  asPactWrite(() => saveEquipment(campaign, getDmTurn(turnId), sheet, equipment, "pact_weapon", delta, reason));
  // The minute apart is over with the weapon's own end.
  const fresh = getSheetById(sheet.id);
  if (fresh?.conditions.some((entry) => textKey(entry) === PACT_APART)) {
    const meta = { ...(fresh.conditionMeta as Record<string, unknown>) };
    delete meta[PACT_APART];
    const updated = asPactWrite(() => patchSheet(sheet.id, { conditions: fresh.conditions.filter((entry) => textKey(entry) !== PACT_APART), conditionMeta: meta as CharacterSheet["conditionMeta"] }));
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
}

// A magic weapon: one of the table's magic items, or a weapon whose name
// carries its bonus ("+1 Longsword").
// "You can't affect an artifact or a sentient weapon in this way" is the GM's:
// no SRD 5.1 weapon is either, and no field of a row says so.
const isMagicWeapon = (row: EquipmentItem) => Boolean(weaponRowOf(row)) && (Boolean(matchMagicItem(row)) || magicItemBonus(row.name) > 0);

// The row as an ordinary one: no longer the pact's.
function withoutMark(row: EquipmentItem): EquipmentItem {
  const plain = { ...row };
  delete plain.pact;
  return plain;
}

function atTheirFeet(campaign: Campaign, sheet: CharacterSheet, row: EquipmentItem) {
  const { map, token } = standing(campaign.id, sheet.id);
  const plain = withoutMark(row);
  insertDroppedItem({
    campaignId: campaign.id,
    mapId: map && token ? map.id : null,
    x: token?.x ?? null,
    y: token?.y ?? null,
    place: placeName(campaign.id),
    item: handedOverRow(plain, row.qty ?? 1),
    droppedBy: sheet.name,
  });
}

export function pactOfTheBlade(campaign: Campaign, turnId: string, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsPactOfTheBlade(sheet)) {
    return { error: `${sheet.name} does not have the Pact of the Blade (a warlock's 3rd level boon).`, refused: "rules" };
  }
  const asked = (variant ?? "").trim();
  const key = textKey(asked);
  const mark = conjuredMark(sheet.id);
  const conjured = sheet.equipment.filter((item) => item.pact === mark);
  const bonded = sheet.equipment.find((item) => item.pact === "bonded" || item.pact === "stowed") ?? null;
  const rest = sheet.equipment.filter((item) => item.pact !== mark);

  if (DISMISS.has(key)) {
    const out = sheet.conditions.some((entry) => textKey(entry) === PACT_APART);
    if (!conjured.length && bonded?.pact !== "bonded" && !out) {
      return { error: `${sheet.name} has no pact weapon out to dismiss. Nothing was spent.`, refused: "rules" };
    }
    const equipment = rest.map((item) => (item === bonded && item.pact === "bonded" ? { ...item, pact: "stowed", equipped: false } : item));
    write(campaign, turnId, sheet, equipment, { dismissed: conjured[0]?.name ?? bonded?.name ?? "pact weapon" }, "Pact of the Blade: the weapon dismissed");
    vanishStrays(campaign.id, sheet.id);
    return {
      ok: true,
      resource: "Pact of the Blade",
      cost: "no action",
      applied: bonded?.pact === "bonded" && !conjured.length
        ? `${sheet.name} dismisses ${bonded.name} into its extradimensional space; it appears again when they create their pact weapon.`
        : `${sheet.name}'s pact weapon vanishes.`,
    };
  }

  const fight = inFight(campaign);
  // 'bond', or 'bond' and the weapon's name as the sheet lists it.
  const [first = "", ...others] = asked.split(" ");
  const bonding = textKey(first) === "bond";
  if (BREAK.has(key) || bonding) {
    if (fight) {
      return { error: "The pact weapon's ritual takes an hour, a short rest's worth: not in the middle of a fight. Nothing was spent.", refused: "rules" };
    }
    if (BREAK.has(key)) {
      if (!bonded) {
        return { error: `${sheet.name} has no weapon bonded as their pact weapon. Nothing was spent.`, refused: "rules" };
      }
      const plain = withoutMark(bonded);
      const stowed = bonded.pact === "stowed";
      if (stowed) {
        atTheirFeet(campaign, sheet, bonded);
      }
      write(campaign, turnId, sheet, stowed ? rest.filter((item) => item !== bonded) : rest.map((item) => (item === bonded ? plain : item)), { unbonded: bonded.name }, "Pact of the Blade: the bond broken");
      advanceClock(campaign.id, RITUAL_MINUTES, "minutes");
      return { ok: true, resource: "Pact of the Blade", applied: `After an hour's ritual ${bonded.name} is no longer ${sheet.name}'s pact weapon${stowed ? ", and it appears at their feet" : ""}. The clock moved on an hour.` };
    }
    const named = others.join(" ").trim();
    const unbound = sheet.equipment.filter((item) => !item.pact);
    const row = named
      ? unbound[lineNamed(unbound, named)] ?? null
      : unbound.find((item) => isMagicWeapon(item) && inHand(item, sheet.equipment)) ?? null;
    if (!row) {
      return { error: named ? `${sheet.name} carries no "${named}" to bond. Name the magic weapon as their sheet lists it: variant 'bond <weapon>'. Nothing was spent.` : `${sheet.name} holds no magic weapon to bond. Name it: variant 'bond <weapon>'. Nothing was spent.`, retry: true };
    }
    if (!isMagicWeapon(row)) {
      return { error: `The ritual transforms a magic weapon, and ${row.name} is not one. Their pact makes a weapon of any melee form with the action instead (variant: the form). Nothing was spent.`, refused: "rules" };
    }
    if (!inHand(row, sheet.equipment)) {
      return { error: `${sheet.name} performs the ritual while holding the weapon, and ${row.name} is not in hand. Draw it first (handle_item equip). Nothing was spent.`, retry: true };
    }
    // "if you perform the 1-hour ritual on a different weapon": the earlier
    // bond ends, and a weapon in the space appears at their feet.
    if (bonded?.pact === "stowed") {
      atTheirFeet(campaign, sheet, bonded);
    }
    const equipment = rest
      .filter((item) => !(item === bonded && bonded.pact === "stowed"))
      .map((item) => {
        if (item === row) {
          return { ...item, pact: "bonded" };
        }
        if (item === bonded) {
          return withoutMark(item);
        }
        return item;
      });
    write(campaign, turnId, sheet, equipment, { bonded: row.name }, "Pact of the Blade: a magic weapon bonded");
    vanishStrays(campaign.id, sheet.id);
    advanceClock(campaign.id, RITUAL_MINUTES, "minutes");
    return {
      ok: true,
      resource: "Pact of the Blade",
      applied: `After an hour's ritual ${row.name} is ${sheet.name}'s pact weapon${bonded ? `, and ${bonded.name} no longer is${bonded.pact === "stowed" ? " (it appears at their feet)" : ""}` : ""}. Variant 'dismiss' sends it to its extradimensional space, and creating the pact weapon brings it back. The clock moved on an hour.`,
    };
  }

  // ---- create ----
  const form = bonded ? null : matchWeapon({ name: asked });
  if (!bonded && (!asked || !form || form.kind !== "melee")) {
    return {
      error: `Pact of the Blade creates a melee weapon in a form ${sheet.name} chooses: name it in variant (longsword, greatsword, rapier, glaive...)${asked ? `; "${asked}" is not a melee weapon` : ""}. Variant 'dismiss' sends it away, 'bond <weapon>' binds a magic weapon over an hour. Ask the player which form, unless they named one. Nothing was spent.`,
      retry: true,
    };
  }
  const price = priceTheAction(sheet, fight, "creating the pact weapon");
  if ("error" in price) {
    return toolError(price);
  }
  // "in your empty hand": the weapon it replaces is gone first.
  const freed = rest.map((item) => (item === bonded ? { ...item, pact: "stowed", equipped: false } : item));
  const name = bonded ? bonded.name : `Pact ${form?.name}`;
  const withRow: EquipmentItem[] = bonded
    ? freed.map((item) => (item.pact === "stowed" ? { ...item, pact: "bonded" } : item))
    : // Carried under its own name, and the weapon of the table it is the form of.
      [...freed, { name, qty: 1, pact: mark, ...(form ? { srdName: form.name } : {}) }];
  const taken = holdIfFree(withRow, name);
  if (!taken.held) {
    return { error: `${sheet.name} has no empty hand for the pact weapon: they must put something away first (handle_item unequip). Nothing was spent.`, refused: "rules" };
  }
  write(campaign, turnId, sheet, taken.equipment, { created: name }, "Pact of the Blade: the pact weapon created");
  vanishStrays(campaign.id, sheet.id);
  price.commit();
  return {
    ok: true,
    resource: "Pact of the Blade",
    ...(fight ? { cost: "their action" } : {}),
    applied: bonded
      ? `${bonded.name}, ${sheet.name}'s bonded pact weapon, appears in their hand.`
      : `${name} appears in ${sheet.name}'s hand${conjured.length ? `, and ${conjured[0].name} vanishes` : ""}: they are proficient with it and it strikes as a magical weapon. Attack with it by that name. It vanishes if it is away from them for a minute, when they create another, on variant 'dismiss', or if they die.`,
  };
}

export function bookOfShadows(campaign: Campaign, turnId: string, stale: CharacterSheet): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!chosenOptions([...sheet.features], "pact_boon").some((option) => textKey(option) === textKey("Pact of the Tome"))) {
    return { error: `${sheet.name} does not have the Pact of the Tome (a warlock's 3rd level boon).`, refused: "rules" };
  }
  if (inFight(campaign)) {
    return { error: "The ceremony for a new Book of Shadows takes an hour, during a short or long rest: not in the middle of a fight. Nothing was spent.", refused: "rules" };
  }
  // "it destroys the previous book", wherever it lies.
  const tome = tomeMark(sheet.id);
  let destroyed = sheet.equipment.some(isBookOfShadows);
  for (const dropped of listDroppedItems(campaign.id)) {
    if ((dropped.item as EquipmentItem).pact === tome) {
      takeFromDroppedItem(dropped.id, dropped.item.qty ?? 1);
      destroyed = true;
    }
  }
  for (const other of listSheets(campaign.id)) {
    const taken = other.id !== sheet.id && (other.equipment.find((item) => item.pact === tome) ?? null);
    if (taken) {
      const updated = patchSheet(other.id, { equipment: other.equipment.filter((item) => item !== taken) });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
      destroyed = true;
    }
  }
  const equipment: EquipmentItem[] = [...sheet.equipment.filter((item) => !isBookOfShadows(item)), { name: BOOK_OF_SHADOWS, qty: 1, pact: tome }];
  saveEquipment(campaign, getDmTurn(turnId), sheet, equipment, "book_of_shadows", { replaced: destroyed }, "Pact of the Tome: a new Book of Shadows");
  advanceClock(campaign.id, RITUAL_MINUTES, "minutes");
  return {
    ok: true,
    resource: "Book of Shadows",
    applied: `After an hour's ceremony ${sheet.name}'s patron gives them a new Book of Shadows${destroyed ? ", and the previous book is destroyed" : ""}. The clock moved on an hour.`,
  };
}
