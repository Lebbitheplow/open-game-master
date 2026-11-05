"use client";

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select, type SelectOption } from "@/components/ui/Select";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { DictateField } from "@/components/DictateField";
import { appendDictation } from "@/lib/dictation";
import { Field, FieldLabel, addChip, chipRow, rowIcon } from "@/app/workshop/kit";
import { MonsterRosterPicker } from "@/app/campaigns/[campaignId]/MonsterRosterPicker";
import { GroundEditor, type GroundMap } from "@/app/workshop/encounters/EncounterGround";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { CONDITION_OPTIONS } from "@/lib/dm/catalog-vocab";
import { formatRoster, parseRoster, type RosterSlot } from "@/lib/dm/encounter-template-logic";
import {
  FIGHT_EVENT_LIMITS,
  fitArrivals,
  type FightAction,
  type FightEvent,
  type FightTrigger,
} from "@/lib/dm/fight-event-logic";

// The Events of a prepared fight (issue 685; what they do at the table:
// src/lib/dm/fight-event-logic.ts). An event is a moment picked from a list
// and what happens then, each part picked too: the creature from the roster,
// the monsters from this world's bestiary, the condition from the rules, the
// squares of a change of ground on the fight's prepared map. The only words
// typed are the GM's own announcement. Shown under the phases once the fight
// has a roster, and only on a host that runs events.

type Slots = RosterSlot[];
type ActionOf<K extends FightAction["kind"]> = Extract<FightAction, { kind: K }>;

const TRIGGERS: SelectOption<FightTrigger["kind"]>[] = [
  { value: "start", label: "When the fight starts", hint: "Before anyone's first turn" },
  { value: "round", label: "When a round begins" },
  { value: "bloodied", label: "When a creature is bloodied", hint: "Down to half its hit points or less" },
  { value: "falls", label: "When a creature falls", hint: "Dead, fled or knocked out" },
];

// `label` heads the action and names its add button; `noun` is how a screen
// reader hears it inside a sentence.
const ACTIONS: Record<FightAction["kind"], { label: string; noun: string }> = {
  reinforce: { label: "More creatures arrive", noun: "more creatures arriving" },
  hurt: { label: "A creature is hurt", noun: "a creature hurt" },
  condition: { label: "A creature's condition", noun: "a creature's condition" },
  visibility: { label: "A creature appears or hides", noun: "a creature appearing or hiding" },
  ground: { label: "The ground changes", noun: "the ground changing" },
  say: { label: "Tell the table", noun: "words for the table" },
};
const ACTION_KINDS = Object.keys(ACTIONS) as Array<FightAction["kind"]>;

function newTrigger(kind: FightTrigger["kind"], slots: Slots): FightTrigger {
  if (kind === "round") return { kind, round: FIGHT_EVENT_LIMITS.roundMin + 1 };
  if (kind === "bloodied" || kind === "falls") return { kind, slot: slots[0]?.slot ?? 0 };
  return { kind: "start" };
}

function newAction(kind: FightAction["kind"], slots: Slots): FightAction {
  const slot = slots[0]?.slot ?? 0;
  switch (kind) {
    case "reinforce":
      return { kind, enemies: [], at: "any" };
    case "hurt":
      return { kind, slot, to: "half" };
    case "condition":
      return { kind, slot, condition: "prone", remove: false };
    case "visibility":
      return { kind, slot, hidden: false };
    case "ground":
      return { kind, tiles: [], terrain: "wall" };
    case "say":
      return { kind, text: "" };
  }
}

const removeButton = cn(ui.iconAction, rowIcon, "hover:text-red-300");

// A creature's name as the plan above draws it: the roster's slots are
// named as typed ("goblin 1"), and the plan's chips capitalize each word, so
// the same goblin read "Goblin 1" there and "goblin 1" in its event.
const slotName = (label: string) => label.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`);

export function EncounterEvents({
  campaignId,
  slots,
  hasEntry,
  map,
  value,
  onChange,
}: {
  campaignId: string;
  slots: Slots;
  // The plan sets where the party comes in, so a wave can come in there.
  hasEntry: boolean;
  // The fight's prepared map, drawn whole, or null: a change of ground names
  // its squares, so it is offered only with one.
  map: GroundMap | null;
  value: FightEvent[];
  onChange: (next: FightEvent[]) => void;
}) {
  const capabilities = useCapabilities();
  if (!slots.length || !hostOffers(capabilities, "fightEvents")) {
    return null;
  }
  const groundHost = hostOffers(capabilities, "fightGround");
  const kinds = ACTION_KINDS.filter((kind) => kind !== "ground" || Boolean(groundHost && map));
  const setEvent = (index: number, next: FightEvent) => onChange(value.map((event, at) => (at === index ? next : event)));
  return (
    <div className="space-y-1.5 text-sm">
      <SectionHead title="Events" glyph="cue-gong" className="mb-1" />
      <p className="text-[11px] text-stone-500">
        What happens on its own during the fight, once each: more creatures arrive, one is hurt, an ambusher appears.
        Events change the fight; they never decide a roll.
      </p>
      {groundHost && !map ? (
        <p className="text-[11px] text-stone-500">
          An event can change the ground, such as a bridge that gives way, only on a prepared map: link one above to pick its squares.
        </p>
      ) : null}
      {value.length ? (
        <ul className="stagger space-y-2">
          {value.map((event, index) => (
            <li key={index} className="rounded-lg border border-stone-700/70 p-2">
              <EventEditor
                campaignId={campaignId}
                event={event}
                number={index + 1}
                slots={slots}
                hasEntry={hasEntry}
                map={map}
                kinds={kinds}
                onChange={(next) => setEvent(index, next)}
                onRemove={() => onChange(value.filter((_, at) => at !== index))}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {value.length < FIGHT_EVENT_LIMITS.events ? (
        <button
          type="button"
          onClick={() => onChange([...value, { trigger: { kind: "start" }, actions: [] }])}
          className={cn(ui.btnSmall, addChip)}
        >
          <Plus className="size-3" aria-hidden="true" /> Add an event
        </button>
      ) : null}
    </div>
  );
}

function EventEditor({
  campaignId,
  event,
  number,
  slots,
  hasEntry,
  map,
  kinds,
  onChange,
  onRemove,
}: {
  campaignId: string;
  event: FightEvent;
  number: number;
  slots: Slots;
  hasEntry: boolean;
  map: GroundMap | null;
  // What an event may do here: a change of ground only with a map.
  kinds: Array<FightAction["kind"]>;
  onChange: (next: FightEvent) => void;
  onRemove: () => void;
}) {
  const name = `Event ${number}`;
  const nameInText = `event ${number}`;
  const trigger = event.trigger;
  const slotOptions = slots.map((slot) => ({ value: String(slot.slot), label: slotName(slot.label) }));
  const setAction = (index: number, next: FightAction) =>
    onChange({ ...event, actions: event.actions.map((action, at) => (at === index ? next : action)) });
  return (
    <div role="group" aria-label={name} className="space-y-2">
      {/* The fields wrap among themselves and the event's remove button
          stays at their end: wrapped with them, it sat alone on a row of
          its own on a phone, apart from the event it removes. */}
      <div className="flex items-end gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5">
          <Field label="When" className="min-w-48 flex-1">
            <Select
              label={`${name}: when`}
              value={trigger.kind}
              options={TRIGGERS}
              onChange={(kind) => onChange({ ...event, trigger: newTrigger(kind, slots) })}
            />
          </Field>
          {trigger.kind === "round" ? (
            <Field label="Round">
              <NumberStepper
                label={`${name}: round`}
                value={trigger.round}
                min={FIGHT_EVENT_LIMITS.roundMin}
                max={FIGHT_EVENT_LIMITS.roundMax}
                onChange={(round) => onChange({ ...event, trigger: { kind: "round", round } })}
              />
            </Field>
          ) : null}
          {trigger.kind === "bloodied" || trigger.kind === "falls" ? (
            <Field label="Which creature" className="min-w-40 flex-1">
              <Select
                label={`${name}: which creature`}
                value={String(trigger.slot)}
                options={slotOptions}
                onChange={(slot) => onChange({ ...event, trigger: { kind: trigger.kind, slot: Number(slot) } })}
              />
            </Field>
          ) : null}
        </div>
        <button type="button" aria-label={`Remove ${nameInText}`} title="Remove this event" onClick={onRemove} className={removeButton}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {event.actions.length ? (
        <ol className="space-y-2">
          {event.actions.map((action, index) => (
            <li key={index} className="flex items-start gap-1.5 border-l-2 border-amber-500/30 pl-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <FieldLabel>{ACTIONS[action.kind].label}</FieldLabel>
                <ActionEditor
                  campaignId={campaignId}
                  action={action}
                  name={`${name}, ${ACTIONS[action.kind].noun}`}
                  slots={slots}
                  slotOptions={slotOptions}
                  hasEntry={hasEntry}
                  map={map}
                  onChange={(next) => setAction(index, next)}
                />
              </div>
              <button
                type="button"
                aria-label={`Remove ${ACTIONS[action.kind].noun} from ${nameInText}`}
                title="Remove this"
                onClick={() => onChange({ ...event, actions: event.actions.filter((_, at) => at !== index) })}
                className={removeButton}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-amber-300/85">Add what happens: an event with nothing in it is not saved.</p>
      )}
      {event.actions.length < FIGHT_EVENT_LIMITS.actions ? (
        <div role="group" aria-label={`${name}: add what happens`} className={chipRow}>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChange({ ...event, actions: [...event.actions, newAction(kind, slots)] })}
              className={cn(ui.btnSmall, addChip)}
            >
              <Plus className="size-3" aria-hidden="true" /> {ACTIONS[kind].label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionEditor({
  campaignId,
  action,
  name,
  slots,
  slotOptions,
  hasEntry,
  map,
  onChange,
}: {
  campaignId: string;
  action: FightAction;
  name: string;
  slots: Slots;
  slotOptions: SelectOption<string>[];
  hasEntry: boolean;
  map: GroundMap | null;
  onChange: (next: FightAction) => void;
}) {
  const who = (slot: number, set: (slot: number) => void) => (
    <Field label="Who" className="min-w-40 flex-1">
      <Select label={`${name}: who`} value={String(slot)} options={slotOptions} onChange={(next) => set(Number(next))} />
    </Field>
  );
  switch (action.kind) {
    case "reinforce":
      return <ReinforceEditor campaignId={campaignId} action={action} name={name} slots={slots} hasEntry={hasEntry} onChange={onChange} />;
    case "hurt":
      return (
        <div className="flex flex-wrap items-end gap-1.5">
          {who(action.slot, (slot) => onChange({ ...action, slot }))}
          <Field label="Down to" className="min-w-48 flex-1">
            <Select<"half" | "hp">
              label={`${name}: down to`}
              value={action.to}
              options={[
                { value: "half", label: "Half its hit points (bloodied)" },
                { value: "hp", label: "A number of hit points" },
              ]}
              onChange={(to) => onChange(to === "hp" ? { ...action, to, hp: action.hp ?? 1 } : { kind: "hurt", slot: action.slot, to })}
            />
          </Field>
          {action.to === "hp" ? (
            <Field label="Hit points left">
              <NumberStepper
                label={`${name}: hit points left`}
                value={action.hp ?? 1}
                min={1}
                max={FIGHT_EVENT_LIMITS.hp}
                onChange={(hp) => onChange({ ...action, hp })}
              />
            </Field>
          ) : null}
        </div>
      );
    case "condition":
      return (
        <div className="flex flex-wrap items-end gap-1.5">
          {who(action.slot, (slot) => onChange({ ...action, slot }))}
          <Field label="Gains or loses" className="min-w-32">
            <Select<"gains" | "loses">
              label={`${name}: gains or loses`}
              value={action.remove ? "loses" : "gains"}
              options={[
                { value: "gains", label: "Gains" },
                { value: "loses", label: "Loses" },
              ]}
              onChange={(next) => onChange({ ...action, remove: next === "loses" })}
            />
          </Field>
          <Field label="Condition" className="min-w-40 flex-1">
            <Select
              label={`${name}: condition`}
              value={action.condition}
              options={CONDITION_OPTIONS}
              onChange={(condition) => onChange({ ...action, condition })}
            />
          </Field>
        </div>
      );
    case "visibility":
      return (
        <div className="flex flex-wrap items-end gap-1.5">
          {who(action.slot, (slot) => onChange({ ...action, slot }))}
          <Field label="It" className="min-w-48 flex-1">
            <Select<"appears" | "hides">
              label={`${name}: appears or hides`}
              value={action.hidden ? "hides" : "appears"}
              options={[
                { value: "appears", label: "Appears", hint: "The party sees it on the board" },
                { value: "hides", label: "Hides", hint: "Off the party's board and tracker" },
              ]}
              onChange={(next) => onChange({ ...action, hidden: next === "hides" })}
            />
          </Field>
        </div>
      );
    case "ground":
      return map ? (
        <GroundEditor action={action} name={name} map={map} onChange={onChange} />
      ) : (
        <p className="text-[11px] text-amber-300/85">This needs the fight&rsquo;s prepared map: link one above, or it is not saved.</p>
      );
    case "say":
      return (
        <Field as="label" label="The words">
          <DictateField
            label={`${name}: the words`}
            onTranscript={(text) => onChange({ ...action, text: appendDictation(action.text, text, FIGHT_EVENT_LIMITS.say) })}
          >
            <textarea
              value={action.text}
              maxLength={FIGHT_EVENT_LIMITS.say}
              rows={2}
              placeholder="The rope bridge groans, and the far end gives way."
              onChange={(next) => onChange({ ...action, text: next.target.value })}
              className={ui.input}
            />
          </DictateField>
        </Field>
      );
  }
}

function ReinforceEditor({
  campaignId,
  action,
  name,
  slots,
  hasEntry,
  onChange,
}: {
  campaignId: string;
  action: ActionOf<"reinforce">;
  name: string;
  slots: Slots;
  hasEntry: boolean;
  onChange: (next: FightAction) => void;
}) {
  const where: SelectOption<string>[] = [
    { value: "any", label: "Where the fight puts them" },
    ...(hasEntry ? [{ value: "entry", label: "Where the party came in" }] : []),
    ...slots.map((slot) => ({ value: `slot:${slot.slot}`, label: `Beside ${slotName(slot.label)}` })),
  ];
  const whereValue = action.at === "slot" && action.slot !== undefined ? `slot:${action.slot}` : action.at === "entry" && !hasEntry ? "any" : action.at;
  const setEnemies = (enemies: ActionOf<"reinforce">["enemies"]) => onChange({ ...action, enemies: fitArrivals(enemies) });
  return (
    <div className="space-y-1.5">
      <MonsterRosterPicker
        campaignId={campaignId}
        roster={formatRoster(action.enemies)}
        onChange={(roster) => setEnemies(parseRoster(roster))}
      />
      {action.enemies.length ? (
        <ul className={chipRow} aria-label={`${name}: who arrives`}>
          {action.enemies.map((row, index) => (
            <li key={`${row.monster}-${index}`} className="flex items-center gap-1 rounded-lg border border-stone-700/70 py-0.5 pl-2">
              <span className="text-stone-200">{row.monster}</span>
              <NumberStepper
                label={`How many ${row.monster}`}
                value={row.count}
                min={1}
                max={FIGHT_EVENT_LIMITS.arrivals}
                size="sm"
                onChange={(count) => setEnemies(action.enemies.map((entry, at) => (at === index ? { ...entry, count } : entry)))}
              />
              <button
                type="button"
                aria-label={`Remove ${row.monster}`}
                onClick={() => setEnemies(action.enemies.filter((_, at) => at !== index))}
                className={removeButton}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-stone-500">Search above and pick who arrives.</p>
      )}
      <Field label="Where they come in">
        <Select
          label={`${name}: where they come in`}
          value={whereValue}
          options={where}
          onChange={(next) =>
            onChange(
              next.startsWith("slot:")
                ? { ...action, at: "slot", slot: Number(next.slice(5)) }
                : { kind: "reinforce", enemies: action.enemies, at: next === "entry" ? "entry" : "any" },
            )
          }
        />
      </Field>
    </div>
  );
}
