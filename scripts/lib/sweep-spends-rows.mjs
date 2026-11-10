// The rows of the "spends" sweep (scripts/lib/sweep-spends.mjs): one for every
// counter in RESOURCE_DEFS, one for every authored spend and one for every
// authored reaction, each with the holder that first has it, the doors it is
// played through and the text it is held to.
import { statesMechanic } from "./sweep-spends.mjs";
import { arrivals, engineMentions, featureTexts } from "./sweep-spends-catalogue.mjs";
import { short } from "./sweep-spends-walk.mjs";

const SRC = new URL("../../src/", import.meta.url);

// Which suite walks a row. Every row belongs to exactly one.
export const FAMILIES = {
  // The classes' own counters, the species' and the feats'; then the subclasses'.
  srd: (row) => row.kind === "counter" && row.family === "srd" && !/^counter:(?:sub|art)_/.test(row.id),
  subclass: (row) => row.kind === "counter" && row.family === "srd" && /^counter:(?:sub|art)_/.test(row.id),
  "genre-a": (row) => row.kind === "counter" && row.family === "genre" && /^counter:(?:cyberpunk|dark_fantasy|horror)_/.test(row.id),
  "genre-b": (row) => row.kind === "counter" && row.family === "genre" && !/^counter:(?:cyberpunk|dark_fantasy|horror)_/.test(row.id),
  authored: (row) => row.kind === "spend",
  reactions: (row) => row.kind === "reaction",
};

const sentences = (text) => (text ?? "").split(/(?<=[.!?;])\s+/).filter(Boolean);

// The sentence of a text to quote as the rule: the one that names the row,
// else a reaction's own, else the first that states a mechanic.
function quote(text, name, reaction) {
  const list = sentences(text);
  const words = (name ?? "").toLowerCase();
  const picked =
    (words && list.find((sentence) => sentence.toLowerCase().includes(words))) ||
    (reaction && list.find((sentence) => /\breaction\b/i.test(sentence))) ||
    list.find((sentence) => statesMechanic(sentence)) ||
    list[0] || "";
  return short(picked, 320);
}

// What the text says about when a use comes back, when it says so outright.
export function statedRecharge(text) {
  const brief = /(?:per|a|every) short(?: or long)? rest|recharges? on a short|regained on a short|\d\/short rest|\d\/rest\b/i.test(text ?? "");
  const long = /(?:per|a|every) long rest|recharges? on a long rest|regained on a long rest|\d\/long rest|once (?:per|a) day|\d\/day/i.test(text ?? "");
  return brief === long ? null : brief ? "short" : "long";
}

// The text opens with something that must have happened first: a trigger,
// not a choice made with an action of the holder's own turn.
const EVENT = /\b(?:when|whenever|if|after)\b[^;:.]*?\b(?:hits? you|hit by|is hit|are hit|a hit|you hit|takes? (?:\w+ )?damage|fails? (?:a|an|its|their|your)|drops? to 0|would drop|reduced to 0|reduced below|reduces? (?:you|a|an)|misses|is attacked|attacks? (?:you|a|an|one)|has attacked|targets? you|targeted|dies|is destroyed|you fail|you miss|you reduce|you kill|you slay|succeeds? on|stabilize|expend your last|combat starts|you enter your rage|you use)\b/i;
export function opensWithTrigger(text) {
  let lead = (text ?? "").trim();
  lead = lead.replace(/^[A-Z][A-Za-z' -]{2,40}:\s+(?=[a-z])/, "");
  lead = lead.replace(/^(?:\d+\/(?:short |long )?(?:rest|day)|once (?:per|a) (?:short |long )?(?:rest|day|turn)|(?:CON|WIS|INT|CHA|STR|DEX)-mod uses per (?:short|long) rest)[,:]?\s*/i, "");
  if (/^(?:as an?|an?|your|use (?:a|your)|with (?:a|your)|spend[^,]*as an?) (?:bonus )?action\b|^(?:bonus )?action:/i.test(lead)) return false;
  // Something done when a rest ends is a choice made then, not a trigger in a fight.
  if (/^(?:when|after) (?:you finish )?an? (?:short|long)(?: or long)? rest\b/i.test(lead)) return false;
  const clause = lead.split(/[;:.]/)[0];
  return /^(?:when|whenever|if|right after|immediately after|reaction\b|a reaction\b|as a reaction\b)/i.test(lead) || EVENT.test(clause);
}

export async function tableRows(rig) {
  const { nameChoice } = await import(new URL("lib/srd/feature-names.ts", SRC).href);
  const found = arrivals(rig);
  const texts = featureTexts(rig);
  const mentions = engineMentions();
  // The text of a feature, from the catalogue its row belongs to.
  const textOf = (prefer, ...names) => names.map((name) => texts.get(name, prefer)).find(Boolean) ?? names.map((name) => texts.any(name)).find(Boolean) ?? null;
  const { HIT_ANSWER_COUNTERS } = await import(new URL("lib/dm/reaction-kinds.ts", SRC).href);
  // A reaction held to its trigger's record that needs a mark laid first
  // (Slayer's Counter answers the creature under Slayer's Prey).
  const { triggerSpecFor } = await import(new URL("lib/srd/trigger-table.ts", SRC).href);
  const preyOf = (item) => (item ? (triggerSpecFor(item.name, { gateCondition: item.gate?.condition })?.on ?? []).flatMap((on) => (on.kind === "save_on_self" && on.prey ? [on.prey] : [])) : []);
  const authoredRows = rig.authored.authoredRows();
  const rows = [];

  // What a gate, a mark or a typed target asks to be true before the call.
  const prefixOf = (item, does) => {
    const gate = item?.gate ?? {};
    return [
      ...(gate.raging ? ["the holder raging"] : []),
      ...(gate.condition ? [`condition: ${gate.condition}`] : []),
      ...(does?.vsMark ? [`mark: ${does.vsMark}`] : []),
      ...(does?.vowed ? ["mark: vow of enmity"] : []),
      ...preyOf(item).map((mark) => `mark: ${mark}`),
      ...(does?.kind === "resist_instance" && does.bond ? ["the holder's drake summoned"] : []),
      ...(does?.kind === "restore" ? [`pool down: ${does.pool}`] : []),
      ...(does?.types?.length && (does.kind === "save_effect" || does.kind === "save_area") ? [`the foe is ${does.types[0]}`] : []),
      ...(item?.usedBy === "inspired" ? ["the ally inspired"] : []),
    ];
  };
  const variantsOf = (does) =>
    does.kind === "variants" ? Object.keys(does.options)
      : does.kind === "choose" ? does.options
        : does.kind === "storm_aura" ? ["desert", "sea", "tundra"]
          : does.kind === "flames" && !does.healOnly ? ["burn", "heal"]
          : does.variants ? [undefined, ...Object.keys(does.variants)]
            : does.typeFromVariant ? does.typeFromVariant
              : [undefined];
  const pickOf = (row, gate) => (gate?.choice ? { feature: row.feature, value: gate.choice } : gate?.choiceOf ? { feature: gate.choiceOf.feature, value: gate.choiceOf.value } : null);

  for (const def of rig.resources.RESOURCE_DEFS) {
    const arrived = found.counters.get(def.into ?? def.id);
    const genre = /^(cyberpunk|dark_fantasy|horror|mystery|post_apocalyptic|steampunk)_/.exec(def.id)?.[1].replace("_", "-");
    const feature = textOf(genre ?? "subclasses", ...def.match, def.displayName);
    const holding = HIT_ANSWER_COUNTERS.find((entry) => entry.id === def.id)?.whileHolding;
    // The authored spend or reaction this counter is the uses of, when there is one of its name.
    const backing = [...found.spends.values(), ...found.reactions.values()].find((entry) => (entry.spend ?? entry.reaction).pool?.id === def.id && rig.textKey((entry.spend ?? entry.reaction).name) === rig.textKey(def.displayName));
    const item = backing ? backing.spend ?? backing.reaction : null;
    const handled = authoredRows.filter((row) => row.entry.counter === def.id && (row.entry.effects?.length || row.entry.spends?.length || row.entry.reactions?.length || row.entry.heldBy)).map((row) => `the authored layer (${row.key})`);
    const text = `${feature?.text ?? ""} ${def.guidance}`.trim();
    const pick = backing ? pickOf(backing.row, item.gate) : null;
    rows.push({
      id: `counter:${def.id}`,
      kind: "counter",
      name: def.displayName,
      def,
      build: arrived ? { ...(backing ? { classId: backing.classId, subclass: backing.subclass, kind: arrived.kind, level: Math.max(arrived.level, backing.level) } : arrived), ...(pick ? { pick } : {}) } : null,
      family: arrived?.kind ?? (/^(?:cyberpunk|dark_fantasy|horror|mystery|post_apocalyptic|steampunk)_/.test(def.id) ? "genre" : "srd"),
      typed: backing ? `authored ${backing.spend ? "spend" : "reaction"} "${item.does.kind}"` : def.effect.kind === "narrative" ? null : `counter effect "${def.effect.kind}"`,
      reaction: def.action === "reaction" || Boolean(backing?.reaction) || item?.action === "reaction",
      passive: Boolean(def.passive),
      variants: item ? variantsOf(item.does).slice(0, 5) : def.effect.kind === "buff" && def.effect.variants?.length ? [undefined, ...def.effect.variants.map((entry) => nameChoice(entry) ?? entry)] : [undefined],
      extra: def.effect.kind === "wild_shape" ? { form: "Wolf" } : item?.does.kind === "move" ? { x: 5, y: 3 } : {},
      prefix: [...prefixOf(item, item?.does), ...(holding ? [`condition: ${holding}`] : [])],
      own: [def.id, ...(def.fallbackPool ? [def.fallbackPool.id] : [])],
      doors: [def.id, def.displayName],
      elsewhere: [...handled, ...mentions(def.id, [def.displayName, ...def.match])],
      text,
      rule: feature ? `"${quote(feature.text, def.displayName, def.action === "reaction")}" (${feature.source}, ${def.match[0] ?? def.displayName})` : `"${quote(def.guidance, def.displayName, false)}" (the counter's guidance, ${def.id})`,
      lead: feature?.text ?? def.guidance,
      featureText: feature?.text ?? null,
      cardMatch: (card) =>
        card.id === `feature:${def.id}` || card.pool === def.id ||
        (card.intent.card === "feature" && [rig.textKey(def.id), rig.textKey(def.displayName)].includes(rig.textKey(card.intent.resourceId ?? ""))) ||
        (card.intent.card === "reaction" && rig.textKey(card.intent.feature ?? "") === rig.textKey(def.displayName)),
    });
  }
  const authoredRow = (kind, entry) => {
    const { row, level, classId, subclass } = entry;
    const item = entry.spend ?? entry.reaction;
    const feature = textOf(row.key.startsWith("genre::") ? "classes/" : "subclasses", row.feature, item.name);
    const does = item.does;
    const pick = pickOf(row, item.gate);
    const own = item.pool && "id" in item.pool ? rig.resources.resourceDef(item.pool.id) : null;
    const shared = own && rig.textKey(own.displayName) !== rig.textKey(item.name) ? own : null;
    return {
      id: `${kind}:${row.key}::${item.name}`,
      kind,
      name: item.name,
      item,
      authored: row,
      build: { classId, subclass, kind: "authored", level, ...(pick ? { pick } : {}) },
      family: row.key.startsWith("genre::") ? "genre" : "srd",
      typed: does.kind === "note" ? null : `authored ${kind} "${does.kind}"`,
      reaction: kind === "reaction" || item.action === "reaction",
      // Taken by someone else: the creature holding the bard's die, or any ally.
      reactor: item.usedBy && item.usedBy !== "holder" ? "ally" : "holder",
      variants: variantsOf(does).slice(0, 5),
      extra: does.kind === "move" ? { x: 5, y: 3 } : {},
      prefix: prefixOf(item, does),
      doors: [item.name, ...(item.aliases ?? []), ...(kind === "spend" && own && !shared ? [own.id] : [])],
      // An option of a shared pool, as "Channel Divinity" with the option as its variant.
      poolDoor: kind === "spend" && shared ? shared.displayName : null,
      pool: item.pool && "id" in item.pool ? item.pool : null,
      own: item.pool && "id" in item.pool ? [item.pool.id, ...(item.pool.fallback ? [item.pool.fallback] : [])] : [],
      gm: Boolean(item.gm),
      elsewhere: [],
      text: `${feature?.text ?? ""} ${does.kind === "note" ? does.text : ""}`.trim(),
      rule: feature ? `"${quote(feature.text, item.name, kind === "reaction")}" (${feature.source}, ${row.classId} ${row.entry.subclass}: ${row.feature})` : `(${row.key}: no feature text found)`,
      lead: feature?.text ?? "",
      featureText: feature?.text ?? null,
      cardMatch: (card) =>
        (card.intent.card === "feature" && rig.textKey(card.intent.resourceId ?? "") === rig.textKey(item.name)) ||
        (card.intent.card === "reaction" && rig.textKey(card.intent.feature ?? "") === rig.textKey(item.name)),
    };
  };
  for (const entry of found.spends.values()) rows.push(authoredRow("spend", entry));
  for (const entry of found.reactions.values()) rows.push(authoredRow("reaction", entry));
  return rows;
}
