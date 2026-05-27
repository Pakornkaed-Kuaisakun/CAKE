// src/cli/hooks/useFinanceTickers.ts
//
// React hook that wires the ticker fetcher into the autocomplete lifecycle.
//
// Behaviour:
//   • On mount: load from disk cache (instant) → then refresh from API (async)
//   • When `query` changes: debounce 250ms → run Yahoo Finance search if
//     the query doesn't match anything in the cached list well enough
//   • Never blocks the UI — all fetches are fire-and-forget with local state
//
// Used by useAutoComplete.ts when the user is on the ticker slot of a
// `finance` command:
//   finance <typing here>
//   finance <ticker> --pdf

import { useState, useEffect, useRef } from "react";
import {
  fetchTickerHints,
  searchTickers,
  FALLBACK_TICKERS,
  type TickerHint,
} from "../hints/financeTickerHints.js";

const DEBOUNCE_MS = 250;

export interface UseFinanceTickersReturn {
  /** Full ticker list (popular/trending) for blank query */
  allTickers: TickerHint[];
  /** Live-filtered list based on current user query */
  filteredTickers: TickerHint[];
  /** True while a network fetch is in flight */
  loading: boolean;
}

/**
 * @param query   The partial symbol the user has typed (e.g. "AA" → filters)
 * @param active  Set false when not on a finance command slot — skips all work
 */
export function useFinanceTickers(
  query: string,
  active: boolean,
): UseFinanceTickersReturn {
  const [allTickers, setAllTickers] = useState<TickerHint[]>(FALLBACK_TICKERS);
  const [filteredTickers, setFilteredTickers] = useState<TickerHint[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFetchedRef = useRef(false);

  // ── Initial load from cache / API ────────────────────────────────────────

  useEffect(() => {
    if (!active || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    fetchTickerHints()
      .then((tickers) => {
        setAllTickers(tickers);
      })
      .catch(() => {
        // keep fallback
      });
  }, [active]);

  // ── Live search as user types ────────────────────────────────────────────

  useEffect(() => {
    if (!active) {
      setFilteredTickers([]);
      return;
    }

    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim().toUpperCase();

    if (!q) {
      // No query → show full popular list (capped at 20 for popup UX)
      setFilteredTickers(allTickers.slice(0, 20));
      return;
    }

    // Immediate local filter from cache (instant feedback)
    const localMatches = allTickers.filter(
      (t) =>
        t.symbol.toUpperCase().startsWith(q) ||
        t.symbol.toUpperCase().includes(q) ||
        t.name.toUpperCase().includes(q),
    );

    // Show local matches instantly
    setFilteredTickers(localMatches.slice(0, 15));

    // Then fire live search after debounce for anything not in cache
    debounceRef.current = setTimeout(async () => {
      // Skip network call if we already have good local coverage
      if (localMatches.length >= 5) return;

      setLoading(true);
      try {
        const liveResults = await searchTickers(q);
        if (liveResults.length > 0) {
          // Merge: live results first, then fill from local matches
          const liveSymbols = new Set(liveResults.map((t: any) => t.symbol));
          const merged = [
            ...liveResults,
            ...localMatches.filter((t) => !liveSymbols.has(t.symbol)),
          ].slice(0, 15);
          setFilteredTickers(merged);

          // Also update allTickers with newly discovered symbols
          setAllTickers((prev) => {
            const prevSymbols = new Set(prev.map((t) => t.symbol));
            const newOnes = liveResults.filter(
              (t: any) => !prevSymbols.has(t.symbol),
            );
            return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
          });
        }
      } catch {
        // keep local matches
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, active, allTickers]);

  return { allTickers, filteredTickers, loading };
}
