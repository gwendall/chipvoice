import { notFound } from "next/navigation";
import Link from "@/i18n/react";
import { childCategories, getCategory, listSounds, searchSounds } from "@/lib/catalog";
import { CategoryGrid, type CategoryGridItem } from "@/components/CategoryGrid";
import { SoundList } from "@/components/SoundList";

/**
 * One route for both taxonomy levels (spec: `/c/<category>`): a top-level
 * branch ("movement") has no sounds of its own and renders as a hub of its
 * leaf children; a leaf ("movement/jump") renders the spec's row list,
 * "every sound of the event, best first".
 */
export default async function CategoryPage({ params }: { params: Promise<{ category: string[] }> }) {
  const { category } = await params;
  const id = category.join("/");
  const found = getCategory(id);
  if (!found) notFound();

  const children = childCategories(id);
  const parent = found.parent ? getCategory(found.parent) : null;

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      {parent && (
        <p className="muted">
          <Link href={`/c/${parent.id}`}>{parent.title}</Link> / {found.title}
        </p>
      )}
      <h1>{found.title}</h1>

      {children.length > 0 ? <ChildGrid childCategories={children} /> : <LeafSounds categoryId={id} />}
    </div>
  );
}

function ChildGrid({ childCategories: children }: { childCategories: ReturnType<typeof childCategories> }) {
  const sounds = listSounds();
  const items: CategoryGridItem[] = children.map((child) => {
    const childSounds = sounds.filter((s) => s.category === child.id).sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id));
    return { id: child.id, title: child.title, count: childSounds.length, topSound: childSounds[0] ?? null };
  });
  return <CategoryGrid items={items} />;
}

function LeafSounds({ categoryId }: { categoryId: string }) {
  const sounds = searchSounds({ category: categoryId });
  if (sounds.length === 0) {
    return <p className="muted">No sounds filed here yet.</p>;
  }
  return <SoundList sounds={sounds} />;
}
