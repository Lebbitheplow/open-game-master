"use client";

import { useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { CountPop } from "@/components/ui/Reveal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatPrice, purseCoins, purseCopper, type Purse } from "@/lib/srd/currency";
import {
  coinWeightLb,
  COINS_PER_POUND,
  loadLines,
  sortLoadLines,
  type Encumbrance,
  type LoadOrder,
  type LoadSort,
  type WeightSource,
} from "@/lib/srd/encumbrance";

// What the Carried tile is made of (issue #206): every line of the pack with
// its count, its weight each and its line total, the purse, and the lines
// nothing could weigh. Read-only, for anyone who can open the sheet. The
// lines are the ones the total is summed from (src/lib/srd/encumbrance.ts
// loadLines), so they add up to the tile by construction, and both redraw
// from the same sheet when it changes.

// A weight the line does not carry itself says where it came from.
const SOURCE_NOTE: Record<WeightSource, string | null> = {
  item: null,
  ammunition: "per round",
  armor: "from the SRD armor table",
  gear: "from the SRD gear table",
  weapon: "from the SRD weapon table",
};

function pounds(value: number, places: number): string {
  return `${Number(value.toFixed(places))} lb`;
}

export function LoadBreakdown({
  open,
  onOpenChange,
  name,
  equipment,
  purse,
  load,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  equipment: Array<{ name: string; qty?: number; weight?: number; equipped?: boolean }>;
  // The purse whose coins the load weighs, as every caller of encumbranceFor
  // counts them (src/lib/srd/currency.ts purseCoins).
  purse: Purse;
  load: Encumbrance;
}) {
  const [key, setKey] = useState<LoadSort>("total");
  const [order, setOrder] = useState<LoadOrder>("desc");
  const lines = sortLoadLines(loadLines(equipment), key, order);
  const coins = purseCoins(purse);
  const floor = load.unweighed > 0;
  const total = `${load.carriedLb}${floor ? "+" : ""} lb`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`What ${name} carries`}
      icon={<GameIcon icon={{ kind: "glyph", key: "coin-purse" }} size="size-6" />}
      width="w-[min(94vw,38rem)]"
    >
      <div className="load-breakdown space-y-3 text-sm text-stone-300">
        <p className="text-xs leading-relaxed text-stone-400">
          <CountPop value={total} className="font-display text-sm text-amber-100">
            {total}
          </CountPop>{" "}
          of a {load.capacityLb} lb carrying capacity.{" "}
          {floor
            ? `${load.unweighed} line${load.unweighed === 1 ? " has" : "s have"} no known weight and ${load.unweighed === 1 ? "is" : "are"} not counted, so the load is at least this.`
            : "Every line has a known weight."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            label="Sort by"
            value={key}
            onChange={setKey}
            options={[
              { value: "total", label: "Line total" },
              { value: "each", label: "Weight each" },
            ]}
          />
          <SegmentedControl
            size="sm"
            label="Order"
            value={order}
            onChange={setOrder}
            options={[
              { value: "desc", label: "Heaviest first", icon: ArrowDownWideNarrow },
              { value: "asc", label: "Lightest first", icon: ArrowUpNarrowWide },
            ]}
          />
        </div>
        <table className="load-table">
          <caption className="sr-only">
            {`${name}'s carried load by line, sorted by ${key === "total" ? "line total" : "weight each"}, ${order === "desc" ? "heaviest" : "lightest"} first. Lines of unknown weight are listed last.`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="load-num">
                Qty
              </th>
              <th scope="col" className="load-num" aria-sort={key === "each" ? (order === "desc" ? "descending" : "ascending") : undefined}>
                Each
              </th>
              <th scope="col" className="load-num" aria-sort={key === "total" ? (order === "desc" ? "descending" : "ascending") : undefined}>
                Total
              </th>
            </tr>
          </thead>
          {/* Keyed by the sort, so a re-sort deals the rows in again. */}
          <tbody key={`${key}-${order}`} className="stagger-up">
            {lines.map((line) => {
              const note = line.source ? SOURCE_NOTE[line.source] : null;
              const worn = equipment[line.index]?.equipped;
              return (
                <tr key={line.index} data-unknown={line.totalLb === null ? "" : undefined}>
                  <th scope="row">
                    <span className="block text-stone-200">{line.name}</span>
                    {worn || note ? (
                      <span className="block text-[11px] text-stone-500">{[worn ? "worn" : null, note].filter(Boolean).join(", ")}</span>
                    ) : null}
                  </th>
                  <td className="load-num">{line.qty}</td>
                  <td className="load-num">{line.eachLb === null ? <span className="load-unknown">unknown</span> : pounds(line.eachLb, 3)}</td>
                  <td className="load-num">{line.totalLb === null ? <span className="load-unknown">unknown</span> : pounds(line.totalLb, 2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">
                <span className="block text-stone-200">Coins</span>
                <span className="block text-[11px] text-stone-500">
                  {formatPrice(purseCopper(purse))}, {COINS_PER_POUND} to the pound
                </span>
              </th>
              <td className="load-num">{coins}</td>
              <td className="load-num">{pounds(1 / COINS_PER_POUND, 3)}</td>
              <td className="load-num">{pounds(coinWeightLb(coins), 2)}</td>
            </tr>
            <tr className="load-sum">
              <th scope="row">Carried</th>
              <td className="load-num" colSpan={3}>
                <CountPop value={total}>{total}</CountPop>
                {floor ? (
                  <span className="block text-[11px] font-normal text-amber-300/90">
                    plus {load.unweighed} line{load.unweighed === 1 ? "" : "s"} of unknown weight
                  </span>
                ) : null}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Dialog>
  );
}
