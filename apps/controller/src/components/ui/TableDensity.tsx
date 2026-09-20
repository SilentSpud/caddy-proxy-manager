"use client";

/**
 * The signed-in user's table density, for every table in the dashboard.
 *
 * Read once by the dashboard layout and held here rather than passed down, because tables sit at
 * every depth - DataTable, and the few pages that use Astryx's Table directly. Held as state so
 * Profile can change it and every table follows at once, before the server round trip that saves
 * it has come back; the layout's next render then hands down the same value.
 */
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { DEFAULT_TABLE_DENSITY, type TableDensity } from "@/src/lib/table-density";

type DensityState = { density: TableDensity; setDensity: (next: TableDensity) => void };

const TableDensityContext = createContext<DensityState>({
  density: DEFAULT_TABLE_DENSITY,
  setDensity: () => {},
});

export function TableDensityProvider({
  initial,
  children,
}: {
  initial: TableDensity;
  children: ReactNode;
}) {
  const [density, setDensity] = useState(initial);
  // The saved value wins once the layout re-renders with it - including one changed in another tab.
  useEffect(() => setDensity(initial), [initial]);
  return (
    <TableDensityContext.Provider value={{ density, setDensity }}>
      {children}
    </TableDensityContext.Provider>
  );
}

/** The density every table should render at. Balanced outside the dashboard. */
export function useTableDensity(): TableDensity {
  return useContext(TableDensityContext).density;
}

/** For the Profile control, which changes it. */
export function useSetTableDensity(): (next: TableDensity) => void {
  return useContext(TableDensityContext).setDensity;
}
