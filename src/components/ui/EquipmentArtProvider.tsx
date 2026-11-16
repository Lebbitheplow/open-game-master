"use client";

import { createContext, useContext, type ReactNode } from "react";

const EquipmentGenre = createContext<string | null>(null);

// Portalled sheets and shop dialogs inherit the table's genre as well.
// Outside a table, equipment keeps the default catalogue artwork.
export function EquipmentArtProvider({ genre, children }: { genre: string | null; children: ReactNode }) {
  return <EquipmentGenre.Provider value={genre}>{children}</EquipmentGenre.Provider>;
}

export function useEquipmentGenre(): string | null {
  return useContext(EquipmentGenre);
}
