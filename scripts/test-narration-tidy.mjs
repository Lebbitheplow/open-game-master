// What the table reads of a turn (src/lib/dm/narration-tidy-logic.ts): a
// fight's bookkeeping taken out of the story, and each sentence said once.
// The inputs are what Qwen3.6-35B at Q2 wrote on an AMD BC-250 on the full
// rules, word for word.
import assert from "node:assert/strict";
import {
  closingQuestion,
  closingVarietyNote,
  createOrphanCloserFilter,
  repeatedClosing,
  repeatsNarration,
  tableNarrationParts,
  withoutCombatBookkeeping,
  withoutOrphanClosers,
  withoutRepeatedSentences,
  withoutToolTalk,
} from "../src/lib/dm/narration-tidy-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const FIGHT = ["Avery", "Bram", "Silent Cultist 1", "Silent Cultist 2", "Silenced Captain", "Masked Thug 1", "Masked Thug 2"];

check("a turn order recited on one line goes, with the heading that opened the fight", () => {
  assert.equal(
    withoutCombatBookkeeping(
      "**Combat begins.** The undead are surprised. 1. Avery (14) 2. Silent Cultist 2 3. Bram (9) 4. Silent Cultist 1 5. Silenced Captain (12) It is Avery's turn.",
      FIGHT,
      "english",
    ),
    "The undead are surprised. It is Avery's turn.",
  );
});

check("a bold list goes with the clause that introduced it, and the story after it stays", () => {
  assert.equal(
    withoutCombatBookkeeping(
      "Avery takes initiative with a roll of 21, while Bram rolls a 6. The updated order is: 1. **Masked Thug 1** 2. **Avery** 3. **Masked Thug 2** 4. **Bram** **Masked Thug 1** is now directly in Avery's path.",
      FIGHT,
      "english",
    ),
    "Avery takes initiative with a roll of 21, while Bram rolls a 6. **Masked Thug 1** is now directly in Avery's path.",
  );
});

check("what is left of a recited order, and a turn heading, go", () => {
  assert.equal(
    withoutCombatBookkeeping("**Avery's Turn** The thug that attacked you recovers its balance. 1. 2. **Avery** **Bram**", FIGHT, "english"),
    "The thug that attacked you recovers its balance.",
  );
});

check("a round heading and a bulleted summary of the round go", () => {
  assert.equal(
    withoutCombatBookkeeping("**Round 1:**\n* **Masked Thug 1 attacks Bram.**\nThe thugs act on the surprised party's lost turn.", FIGHT, "english"),
    "The thugs act on the surprised party's lost turn.",
  );
});

check("a numbered list of anything but the fight's own names stays", () => {
  const text = "You could: 1. Run for the door 2. Fight them here.";
  assert.equal(withoutCombatBookkeeping(text, FIGHT, "english"), text);
});

check("with no fight running nothing is taken", () => {
  const text = "**Combat begins.** 1. Avery (14) 2. Bram (9)";
  assert.equal(withoutCombatBookkeeping(text, [], "english"), text);
});

check("at every other table the English headings stay as written, and the recited order and the bulleted summary go by the fight's own names", () => {
  for (const language of ["italian", "french", "spanish", "german"]) {
    assert.equal(
      withoutCombatBookkeeping("**Avery's Turn** La nebbia sale. 1. Avery (14) 2. Silent Cultist 2 3. Bram (9)\n* **Masked Thug 1 attacks Bram.**", FIGHT, language),
      "**Avery's Turn** La nebbia sale.",
      language,
    );
  }
});

check("a recited order under a bold heading of its own goes with the heading, at a table in any language", () => {
  for (const [language, heading] of [["italian", "**Ordine di iniziativa:**"], ["german", "**Initiative-Reihenfolge:**"], ["english", "**Initiative Order:**"]]) {
    assert.equal(
      withoutCombatBookkeeping(`La lotta comincia.\n\n${heading}\n1. Avery (14)\n2. Silent Cultist 2 (11)\n3. Bram (9)\n\nAvery si muove per prima.`, FIGHT, language),
      "La lotta comincia.\n\nAvery si muove per prima.",
      language,
    );
  }
});

check("an item number left alone on its line by the board-square cut goes with the rest of the recited order", () => {
  // What withoutAsides leaves of Qwen3.5 9B's "1. Shadow Aberration 1 (moves to (7,13))" (scripts/test-claims.mjs)
  // at a table in another language: the sentence quoting the square goes, its item number stays.
  assert.equal(
    withoutCombatBookkeeping("Le ombre girano.\n\n**Ordine di iniziativa:**\n1.\n2. **Avery (your turn)**\n3. Bram\n\nLa nebbia sale.", [...FIGHT, "Shadow Aberration 1"], "italian"),
    "Le ombre girano.\n\nLa nebbia sale.",
  );
  // An order of two, so only one named item is left beside the lone number: still an order, at every table.
  for (const language of ["english", "italian", "french", "spanish", "german"]) {
    assert.equal(
      withoutCombatBookkeeping("Steel flashes.\n\n**Initiative order:**\n1.\n2. Avery (your turn)\n\nWhat do you do?", FIGHT, language),
      "Steel flashes.\n\nWhat do you do?",
      language,
    );
  }
});

check("a later call repeating the earlier call's prose says it once", () => {
  assert.deepEqual(
    withoutRepeatedSentences([
      "The inn erupts into chaos as two masked figures burst in. Jory screams.\n\nIt is Avery's turn. What do you do?",
      "The inn erupts into chaos as two masked figures burst in. Bram draws his blade with a curse.",
    ]),
    ["The inn erupts into chaos as two masked figures burst in. Jory screams.\n\nIt is Avery's turn. What do you do?", "Bram draws his blade with a curse."],
  );
});

check("a reply printed twice in one part keeps one copy, and short lines may repeat", () => {
  const paragraph = "The first thug swings, his club whistling through the air at Bram's head.";
  assert.deepEqual(withoutRepeatedSentences([`${paragraph} "Run!" "Run!"\n\n${paragraph}`]), [`${paragraph} "Run!" "Run!"`]);
});

check("a part left with nothing is dropped", () => {
  const line = "Mist curls over the ford, cold and grey in the morning light.";
  assert.deepEqual(withoutRepeatedSentences([line, line]), [line]);
});

check("a reply that is mostly the last turn's narration is a repeat; one shared line or a new scene is not", () => {
  const last =
    "Avery's blade flashes in the dim light of the ravine. The goblin staggers back against the rocks, snarling. The second goblin circles to your left, spear raised. What will you do?";
  assert.equal(repeatsNarration(last, last), true);
  assert.equal(repeatsNarration(`${last} The wind picks up.`, last), true);
  const fresh =
    "Your sword bites deep into the goblin's shoulder and it drops its spear with a howl. The second goblin circles to your left, spear raised. Bram, you are up.";
  assert.equal(repeatsNarration(fresh, last), false, "one sentence carried over is not a repeat");
  assert.equal(repeatsNarration("The goblin staggers back against the rocks, snarling.", last), false, "one sentence is too little to judge");
  assert.equal(repeatsNarration(last, ""), false);
});

check("a sentence naming a DM tool is the model thinking aloud and goes; tool names that are words stay", () => {
  const leaked =
    'Bram presses forward through the mud. The correct next step is to call move_token for Bram to move somewhere. So we interpret: he intends to close in. The goblin snarls.';
  assert.equal(withoutToolTalk(leaked), "Bram presses forward through the mud. So we interpret: he intends to close in. The goblin snarls.");
  const story = "You travel north for a day, then heal at the shrine before you lift the gate.";
  assert.equal(withoutToolTalk(story), story);
});

check("the same closing question two replies running is found, word for word only", () => {
  // Five replies running ended this way at a table on 2026-10-23.
  const replies = [
    "Millbrook comes into view. The cows low in distress. A figure stands near the well. Elder Wren. What does Kara do?",
    'Elder Wren turns. "You came," he says. What does Kara do?',
  ];
  assert.equal(closingQuestion(replies[1]), "What does Kara do?");
  assert.equal(closingQuestion("The door creaks open."), null, "no question, no closing question");
  assert.equal(closingQuestion('"Who goes there?"'), '"Who goes there?"', "a quoted question counts");
  assert.equal(repeatedClosing(replies), "What does Kara do?");
  assert.equal(repeatedClosing([...replies, "The stag charges the cow. The ground shakes. What does Kara do?"], 3), "What does Kara do?");
  assert.equal(repeatedClosing([replies[0], "Wren leans on his staff. Where will you go first?"]), null, "two different questions");
  assert.equal(repeatedClosing([replies[0], "The stag bursts from the trees."]), null, "the newest ends on the moment");
  assert.equal(repeatedClosing([replies[1]]), null, "one reply is no pattern");
  assert.match(closingVarietyNote("What does Kara do?"), /"What does Kara do\?"/);
});

check("a line of closers nobody opened goes from the top of the narration, in every form (issue 744)", () => {
  for (const orphan of [")*", "]*", ")_", ")*_", "]_", ")**", "))*", "  )*  "]) {
    assert.equal(withoutOrphanClosers(`${orphan}\n\nThe hammer hangs from the strap.`), "The hammer hangs from the strap.", orphan);
  }
});

check("the same line goes from the middle and the end of the narration, and the blank lines close up", () => {
  assert.equal(withoutOrphanClosers("The hammer hangs.\n\n)*\n\nThe strap creaks."), "The hammer hangs.\n\nThe strap creaks.");
  assert.equal(withoutOrphanClosers("The hammer hangs.\n]*\nThe strap creaks."), "The hammer hangs.\nThe strap creaks.");
  assert.equal(withoutOrphanClosers("The hammer hangs.\n\n)_"), "The hammer hangs.");
  assert.equal(withoutOrphanClosers(")*"), "", "a reply of nothing else leaves nothing");
});

check("a closer on a line with anything else in it stays, and text with no orphan comes back untouched", () => {
  for (const kept of [
    "Nice work :)",
    ":)",
    "(like this)*",
    "*(like this)*",
    "*The door (the old one)* creaks.",
    "The door creaks open)* and stops.",
    ")* the door creaks.",
    "[roll:abc]",
    ")",
    "*",
    "***",
    "Two  spaces and\n\n\nthree lines stay as they came.",
  ]) {
    assert.equal(withoutOrphanClosers(kept), kept);
  }
});

check("a line of closers that closes a bracket still open above it stays", () => {
  for (const kept of [
    "*(I turn to the door\nand listen.\n)*",
    "*[I turn to the door\nand listen.\n]*",
    "_(I turn to the door\n\nand listen.\n)_\n\nThe strap creaks.",
    "*(He frowns (again)\nand listens.\n)*",
    "*[(I turn\n])*",
  ]) {
    assert.equal(withoutOrphanClosers(kept), kept);
  }
  assert.equal(withoutOrphanClosers("Kara frowns :(\n\n)*\n\nThe strap creaks."), "Kara frowns :(\n\n)*\n\nThe strap creaks.", "an earlier open bracket fails safe");
});

check("a line of closers goes when the brackets above it are closed or of the other kind", () => {
  assert.equal(withoutOrphanClosers("The door (the old one) creaks.\n\n)*\n\nThe strap creaks."), "The door (the old one) creaks.\n\nThe strap creaks.");
  assert.equal(withoutOrphanClosers("*(I turn\nand listen.\n)*\n\n)*\n\nThe strap creaks."), "*(I turn\nand listen.\n)*\n\nThe strap creaks.", "the first closes the aside, the second nothing");
  assert.equal(withoutOrphanClosers("*(I turn\n]*\nand listen.)*"), "*(I turn\nand listen.)*", "a ] closes no (");
  assert.equal(withoutOrphanClosers(")*\n\n*(I turn\nand listen.\n)*"), "*(I turn\nand listen.\n)*", "an orphan above an aside goes, and the aside's closer stays");
});

// The draft as the reply streams (turn.ts): every way the chunks can split,
// the table is shown what the stored passage keeps of those lines, and never
// a ")*" that then vanishes.
function streamed(text, size) {
  const filter = createOrphanCloserFilter();
  let out = "";
  for (let at = 0; at < text.length; at += size) {
    out += filter.push(text.slice(at, at + size));
  }
  return out + filter.flush();
}

check("a streamed line of closers nobody opened never reaches the draft, however the chunks split", () => {
  const cases = [
    [")*\n\nThe hammer hangs from the strap.", "\nThe hammer hangs from the strap."],
    ["The hammer hangs.\n\n]*\n\nThe strap creaks.", "The hammer hangs.\n\n\nThe strap creaks."],
    ["The hammer hangs.\n)_", "The hammer hangs.\n"],
    ["*(I turn to the door\nand listen.\n)*\nThe strap creaks.", "*(I turn to the door\nand listen.\n)*\nThe strap creaks."],
    ["Kara frowns :(\n)*\nThe strap creaks.", "Kara frowns :(\n)*\nThe strap creaks."],
    ["*The door* creaks.\n**Kara** waits.\n***\n)* she says.", "*The door* creaks.\n**Kara** waits.\n***\n)* she says."],
    ["The door creaks open)*\nand stops.", "The door creaks open)*\nand stops."],
  ];
  for (const [text, shown] of cases) {
    for (const size of [1, 2, 3, 7, text.length]) {
      assert.equal(streamed(text, size), shown, `${JSON.stringify(text)} in chunks of ${size}`);
    }
    assert.equal(streamed(text, 1).replace(/\s+/g, " ").trim(), withoutOrphanClosers(text).replace(/\s+/g, " ").trim(), "what streamed is what is kept");
  }
});

check("a turn's parts read as the table read them, for finalize and for a reroll's parts ahead of its take", () => {
  const parts = [
    ")*\n\nThe hammer hangs from the strap. The next step is to call move_token for Bram. [roll:abc]",
    "The hammer hangs from the strap. The strap creaks and the door gives way.",
  ];
  assert.deepEqual(tableNarrationParts(parts, [], "english"), ["The hammer hangs from the strap.", "The strap creaks and the door gives way."]);
  assert.deepEqual(tableNarrationParts(["**Round 1:** The goblin snarls."], ["Goblin"], "english"), ["The goblin snarls."]);
});

console.log(`narration tidy: ${passed} checks passed`);
