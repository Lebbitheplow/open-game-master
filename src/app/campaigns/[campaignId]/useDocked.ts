"use client";

import { useSyncExternalStore } from "react";

// Its own file because BattleMapPanel, on the table page's first load, asks
// this too: from SidePanel.tsx it would bring the whole panel router along.
// Whether the aside is docked (Tailwind's lg, where `hidden` no longer
// applies) or is the phone's full-screen panel. The panels' animation loops
// key on this, so a board behind the chat on a phone costs no frames.
// A book-style fold opened flat docks too, one column per leaf, however
// narrow the whole is (world.css lays the columns on the leaves).
const DOCKED_QUERY = "(min-width: 64rem), (horizontal-viewport-segments: 2)";

function subscribeDocked(callback: () => void) {
  const media = window.matchMedia(DOCKED_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function readDocked() {
  return window.matchMedia(DOCKED_QUERY).matches;
}

// Whether the two columns are side by side (the fight stage only makes
// sense then; a phone keeps its bottom bar and its Battle tab).
export function useDocked(): boolean {
  return useSyncExternalStore(subscribeDocked, readDocked, () => true);
}

// A window tall enough for the Hand to lie on the staged board's lower edge
// with the board still showing above it. Under it the Hand is the rail in
// the desk, as it is on a tablet on its side (hand.css).
const HAND_ON_BOARD_QUERY = "(min-height: 45rem)";

function subscribeHandOnBoard(callback: () => void) {
  const media = window.matchMedia(HAND_ON_BOARD_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function useHandOnBoardRoom(): boolean {
  return useSyncExternalStore(subscribeHandOnBoard, () => window.matchMedia(HAND_ON_BOARD_QUERY).matches, () => false);
}

// A phone on its side: too short to give the board's order a row of its own.
const SHORT_QUERY = "(max-height: 30rem)";

function subscribeShort(callback: () => void) {
  const media = window.matchMedia(SHORT_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function readShort() {
  return window.matchMedia(SHORT_QUERY).matches;
}

export function useShortWindow(): boolean {
  return useSyncExternalStore(subscribeShort, readShort, () => false);
}
