export type Avatar = { palette: number; variant: number } | null;
export function portrait(id: string, avatar?: Avatar) {
  let seed = 2166136261;
  id = avatar ? `${id}:${avatar.variant}` : id;
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
  let background = pick(["#eadcb6", "#c4d6cc", "#c9cde0", "#e7c5b4"]),
    hair = pick(["#333d35", "#624a3d", "#a76736", "#cda54c"]),
    skin = pick(["#edc799", "#bc835e", "#88533f", "#d6a276"]),
    shirt = pick(["#527e70", "#69729b", "#ad6552", "#b09243"]);
  const fringe = Array.from({ length: 6 }, (_, x) => ({
    x: x + 3,
    y: 3 + Math.floor(random() * 2),
  }));
  if (avatar) {
    background = ["#eadcb6", "#c4d6cc", "#c9cde0", "#e7c5b4"][avatar.palette];
    shirt = ["#b09243", "#527e70", "#69729b", "#ad6552"][avatar.palette];
  }
  return { background, hair, skin, shirt, fringe };
}
export function portraitSvg(id: string, avatar?: Avatar) {
  const { background, hair, skin, shirt, fringe } = portrait(id, avatar);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="192" height="192" shape-rendering="crispEdges"><rect width="12" height="12" fill="${background}"/><rect x="3" y="2" width="6" height="6" fill="${hair}"/><rect x="3" y="4" width="6" height="4" fill="${skin}"/>${fringe.map((p) => `<rect x="${p.x}" y="${p.y}" width="1" height="1" fill="${hair}"/>`).join("")}<path d="M4 5h1v1H4zM7 5h1v1H7zM5 7h2v1H5z" fill="#30372f"/><rect x="2" y="9" width="8" height="3" fill="${shirt}"/><rect x="4" y="8" width="4" height="2" fill="${skin}"/><rect x="5" y="10" width="2" height="2" fill="${background}"/></svg>`;
}
