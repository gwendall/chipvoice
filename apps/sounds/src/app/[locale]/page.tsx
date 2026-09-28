import Link from "@/i18n/react";
import { listCategories, listSounds } from "@/lib/catalog";
import { PACKS } from "@/lib/packs";
import { CategoryGrid, type CategoryGridItem } from "@/components/CategoryGrid";
import { SearchBox } from "@/components/SearchBox";

export default function HomePage() {
  const categories = listCategories();
  const sounds = listSounds();
  const topLevel = categories.filter((c) => c.parent === null);

  const items: CategoryGridItem[] = topLevel.map((branch) => {
    const branchSounds = sounds
      .filter((s) => s.category === branch.id || s.category.startsWith(`${branch.id}/`))
      .sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id));
    return {
      id: branch.id,
      title: branch.title,
      count: branchSounds.length,
      topSound: branchSounds[0] ?? null,
    };
  });

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <h1>A sound-effects bank for game developers and their agents</h1>
      <p className="muted">
        {sounds.length} sounds, {categories.filter((c) => c.parent !== null).length} categories, every one CC0-1.0. Search, preview, download,
        or resolve a whole event list from the API.
      </p>
      <SearchBox />
      <h2 style={{ marginTop: 40 }}>Browse by category</h2>
      <CategoryGrid items={items} />
      {PACKS.length > 0 && (
        <>
          <h2 style={{ marginTop: 40 }}>Starter packs</h2>
          <div className="grid">
            {PACKS.map((pack) => (
              <div key={pack.id} className="card">
                <Link href={`/packs/${pack.id}`} style={{ fontWeight: 600, textDecoration: "none" }}>
                  {pack.title}
                </Link>
                <p className="muted" style={{ fontSize: "0.85em" }}>
                  {pack.description}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
