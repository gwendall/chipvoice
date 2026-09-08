import { portrait, type Avatar } from "./portrait";
import { Thumbnail } from "@/ui/Thumbnail";
/** Original deterministic pixel portraits. Only a public profile ID is used. */
export function PixelAvatar({
  id,
  size = 40,
  avatar,
}: {
  id?: string;
  size?: number;
  avatar?: Avatar;
}) {
  if (!id) return <Thumbnail width={size} className="avatar-thumbnail" />;
  const { background, hair, skin, shirt, fringe } = portrait(id, avatar);
  return (
    <Thumbnail width={size} className="avatar-thumbnail">
      <svg
        width={size}
        height={size}
        viewBox="0 0 12 12"
        shapeRendering="crispEdges"
        aria-hidden="true"
        className="pixel-avatar"
      >
        <rect width="12" height="12" fill={background} />
        <rect x="3" y="2" width="6" height="6" fill={hair} />
        <rect x="3" y="4" width="6" height="4" fill={skin} />
        {fringe.map((p) => (
          <rect key={p.x} x={p.x} y={p.y} width="1" height="1" fill={hair} />
        ))}
        <path d="M4 5h1v1H4zM7 5h1v1H7zM5 7h2v1H5z" fill="#30372f" />
        <rect x="2" y="9" width="8" height="3" fill={shirt} />
        <rect x="4" y="8" width="4" height="2" fill={skin} />
        <rect x="5" y="10" width="2" height="2" fill={background} />
      </svg>
    </Thumbnail>
  );
}
