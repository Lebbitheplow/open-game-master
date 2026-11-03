"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { DENOMINATION_COPPER, formatPrice, purseCopper } from "@/lib/srd/currency";

// Player-to-player trade (docs/vtt-parity-implementation-plan.md 11.2): two
// columns, what I hand over and what I ask for, coins under each. The
// server checks both sides now and again when the other player accepts.

type Picked = Record<string, number>;

function ItemPicker({ sheet, picked, onChange, title }: { sheet: CharacterSheet; picked: Picked; onChange: (next: Picked) => void; title: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{title}</p>
      {sheet.equipment.length ? (
        <ul className="reveal max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {sheet.equipment.map((item) => {
            const qty = picked[item.name] ?? 0;
            return (
              <li key={item.name} className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  aria-pressed={qty > 0}
                  onClick={() => onChange({ ...picked, [item.name]: qty > 0 ? 0 : 1 })}
                  className={cn("min-w-0 flex-1 truncate rounded border px-1.5 py-0.5 text-left", qty > 0 ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-stone-800 text-stone-400 hover:text-stone-200")}
                >
                  {item.name}
                  {item.qty > 1 ? <span className="text-stone-500"> x{item.qty}</span> : null}
                </button>
                {qty > 0 && item.qty > 1 ? (
                  <NumberStepper
                    min={1}
                    max={item.qty}
                    value={qty}
                    onChange={(next) => onChange({ ...picked, [item.name]: Math.max(1, Math.min(item.qty, next || 1)) })}
                    label={`How many ${item.name}`}
                    size="sm"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] italic text-stone-600">Nothing carried.</p>
      )}
    </div>
  );
}

// The coin one side hands over, in gold, silver and copper: the trade moves
// copper (src/lib/dm/trade-logic.ts), and a field of whole gold left 7 sp
// with nothing to offer and no way to ask for less than a gold piece. Each
// stepper stops at what the purse holds of it; the sum is checked below.
const COINS = [
  ["gp", "Gold", DENOMINATION_COPPER.gp],
  ["sp", "Silver", DENOMINATION_COPPER.sp],
  ["cp", "Copper", DENOMINATION_COPPER.cp],
] as const;
type Coins = Record<(typeof COINS)[number][0], number>;
const NO_COINS: Coins = { gp: 0, sp: 0, cp: 0 };
const coinsCopper = (coins: Coins) => COINS.reduce((sum, [code, , each]) => sum + coins[code] * each, 0);

function CoinField({ who, sheet, value, onChange }: { who: string; sheet: CharacterSheet; value: Coins; onChange: (coins: Coins) => void }) {
  const purse = purseCopper(sheet);
  const over = coinsCopper(value) > purse;
  return (
    <div className="space-y-1 text-[11px] text-stone-400">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">Coin, of {formatPrice(purse)}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {COINS.map(([code, name, each]) => (
          <span key={code} className="flex items-center gap-1">
            <NumberStepper
              min={0}
              max={Math.floor(purse / each)}
              value={value[code]}
              onChange={(next) => onChange({ ...value, [code]: Math.max(0, Math.min(Math.floor(purse / each), next || 0)) })}
              label={`${name} ${who} gives`}
              size="sm"
            />
            <span className="text-stone-500">{code}</span>
          </span>
        ))}
      </div>
      {over ? <p className="reveal text-amber-300/90">{who} has only {formatPrice(purse)}.</p> : null}
    </div>
  );
}

export function TradeDialog({ campaignId, me, them, onClose }: { campaignId: string; me: CharacterSheet; them: CharacterSheet; onClose: () => void }) {
  const [give, setGive] = useState<Picked>({});
  const [want, setWant] = useState<Picked>({});
  const [giveCoins, setGiveCoins] = useState<Coins>(NO_COINS);
  const [wantCoins, setWantCoins] = useState<Coins>(NO_COINS);
  const giveCp = coinsCopper(giveCoins);
  const wantCp = coinsCopper(wantCoins);
  const short = giveCp > purseCopper(me) || wantCp > purseCopper(them);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lines = (picked: Picked) => Object.entries(picked).filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty }));
  const empty = !lines(give).length && !lines(want).length && !giveCp && !wantCp;

  async function offer() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/item-proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toCharacterId: them.id, give: lines(give), giveCp, want: lines(want), wantCp }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(String(data.error ?? "The offer could not be made."));
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())} title={`Trade with ${them.name}`} icon={<ArrowLeftRight className="size-4 text-amber-400" />} width="w-[min(94vw,40rem)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/50 p-2.5">
          <p className="font-display text-sm text-amber-100">{me.name} gives</p>
          <ItemPicker sheet={me} picked={give} onChange={setGive} title="From my pack" />
          <CoinField who={me.name} sheet={me} value={giveCoins} onChange={setGiveCoins} />
        </div>
        <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/50 p-2.5">
          <p className="font-display text-sm text-amber-100">{them.name} gives</p>
          <ItemPicker sheet={them} picked={want} onChange={setWant} title="From their pack" />
          <CoinField who={them.name} sheet={them} value={wantCoins} onChange={setWantCoins} />
        </div>
      </div>
      {error ? <p className="motion-shake mt-2 text-[11px] text-red-400">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded border border-stone-700 px-3 py-1 text-xs text-stone-400 hover:bg-stone-900">
          Never mind
        </button>
        <button type="button" disabled={busy || empty || short} onClick={() => void offer()} className="flex items-center gap-1 rounded border border-amber-700 bg-amber-950/50 px-3 py-1 text-xs text-amber-100 disabled:opacity-50">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <ArrowLeftRight className="size-3" />} Offer the trade
        </button>
      </div>
    </Dialog>
  );
}
