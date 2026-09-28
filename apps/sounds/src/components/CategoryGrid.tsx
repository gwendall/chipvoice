import Link from "@/i18n/react";
import type { Sound } from "@/lib/catalog";
import { PlayButton } from "./PlayButton";
import { Waveform } from "./Waveform";

export interface CategoryGridItem {
  id: string;
  title: string;
  count: number;
  topSound: Sound | null;
}

/**
 * The homepage's category grid and a category hub's child-category grid
 * are the same shape (spec: "the category grid, the top sound of each
 * category"), so one component renders both.
 */
export function CategoryGrid({ items }: { items: CategoryGridItem[] }) {
  return (
    <div className="grid">
      {items.map((item) => (
        <div key={item.id} className="card">
          <Link href={`/c/${item.id}`} style={{ fontWeight: 600, textDecoration: "none" }}>
            {item.title}
          </Link>
          <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
            {item.count} sound{item.count === 1 ? "" : "s"}
          </div>
          {item.topSound ? (
            <div className="row" style={{ marginTop: 12 }}>
              <PlayButton sound={item.topSound} label="Preview" />
              <div style={{ flex: 1 }}>
                <Waveform peaks={item.topSound.variants[0]?.peaks ?? []} height={24} />
              </div>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 12, fontSize: "0.85em" }}>
              No sounds filed here yet.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
