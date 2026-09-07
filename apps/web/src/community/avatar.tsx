/** Original deterministic pixel portraits. Only a public profile ID is used. */
export function PixelAvatar({ id, size = 40 }: { id: string; size?: number }) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) {
    seed ^= id.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const pick = (values: string[]) =>
    values[Math.floor(random() * values.length)];
  const background = pick(["#eadcb6", "#c4d6cc", "#c9cde0", "#e7c5b4"]),
    hair = pick(["#333d35", "#624a3d", "#a76736", "#cda54c"]),
    skin = pick(["#edc799", "#bc835e", "#88533f", "#d6a276"]),
    shirt = pick(["#527e70", "#69729b", "#ad6552", "#b09243"]);
  const fringe = Array.from({ length: 6 }, (_, x) => ({
    x: x + 3,
    y: 3 + Math.floor(random() * 2),
  }));
  return (
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
  );
}
