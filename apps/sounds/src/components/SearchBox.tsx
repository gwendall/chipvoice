"use client";
import { useEffect, useRef, useState } from "react";
import type { Sound } from "@/lib/catalog";
import { SoundList } from "./SoundList";

/**
 * The homepage's one search field (spec: "jump", "8-bit coin", "heavy sword
 * hit" - "Typing filters instantly"). Calls the site's own public search API
 * (`/api/v1/sounds`) rather than shipping the whole catalogue to the client -
 * an agent reading this page's network tab sees the same endpoint the docs
 * tell it to call directly.
 */
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Sound[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.key === "/" && !inField) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      fetch(`/api/v1/sounds?q=${encodeURIComponent(trimmed)}&limit=50`)
        .then((r) => r.json())
        .then((data: { sounds: Sound[] }) => {
          if (id === requestId.current) {
            setResults(data.sounds);
            setLoading(false);
          }
        })
        .catch(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div>
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder='"jump", "8-bit coin", "heavy sword hit"'
        aria-label="Search sounds"
        data-testid="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && (
        <div style={{ marginTop: 16 }} data-testid="search-results">
          {loading && !results && <p className="muted">Searching...</p>}
          {results && results.length === 0 && <p className="muted">No sounds match "{query.trim()}".</p>}
          {results && results.length > 0 && <SoundList sounds={results} />}
        </div>
      )}
    </div>
  );
}
