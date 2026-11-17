export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
const n = (value: number) => Math.round(value * 10) / 10;
const point = (x: number, y: number) => `${n(x)} ${n(y)}`;

export function sketchBox({ x, y, width: w, height: h }: Box, seed = 0) {
  const drift = seed % 2 ? 1 : -1;
  const r = Math.min(12, w / 5, h / 4);
  return `M ${point(x + r, y)} Q ${point(x + w / 2, y - drift * 1.5)} ${point(x + w - r, y + drift)}
    Q ${point(x + w + 1, y)} ${point(x + w, y + r)}
    L ${point(x + w + drift, y + h - r)} Q ${point(x + w, y + h + 1)} ${point(x + w - r, y + h)}
    Q ${point(x + w / 2, y + h + drift * 1.4)} ${point(x + r, y + h - drift)}
    Q ${point(x - 1, y + h)} ${point(x, y + h - r)}
    L ${point(x - drift, y + r)} Q ${point(x, y - 1)} ${point(x + r, y)} Z`;
}

export function sketchBubble({ x, y, width: w, height: h }: Box) {
  return `M ${point(x + w * .2, y + 2)}
    C ${point(x + w * .5, y - 4)} ${point(x + w * .85, y - 1)} ${point(x + w - 8, y + 22)}
    C ${point(x + w + 6, y + h * .3)} ${point(x + w + 1, y + h * .75)} ${point(x + w - 17, y + h - 10)}
    C ${point(x + w * .7, y + h + 5)} ${point(x + w * .3, y + h + 1)} ${point(x + 19, y + h - 6)}
    C ${point(x - 3, y + h - 12)} ${point(x - 5, y + h * .35)} ${point(x + 6, y + 20)}
    Q ${point(x + 12, y + 4)} ${point(x + w * .2, y + 2)} Z`;
}

export function sketchOval({ x, y, width, height }: Box, seed = 0) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const drift = seed % 2 ? 1.5 : -1.5;
  return `M ${point(cx + rx, cy + drift)}
    C ${point(cx + rx + 2, cy + ry * .57)} ${point(cx + rx * .5, cy + ry + 1)} ${point(cx - 2, cy + ry)}
    C ${point(cx - rx * .6, cy + ry - 1)} ${point(cx - rx - 1, cy + ry * .5)} ${point(cx - rx, cy)}
    C ${point(cx - rx + 1, cy - ry * .6)} ${point(cx - rx * .5, cy - ry - 1)} ${point(cx + 1, cy - ry)}
    C ${point(cx + rx * .6, cy - ry + 1)} ${point(cx + rx + 2, cy - ry * .5)} ${point(cx + rx, cy + drift)}`;
}

export function sketchUnderline({ x, y, width, height }: Box, seed = 0) {
  const bottom = y + height + 2;
  const drift = seed % 2 ? 1 : -1;
  return `M ${point(x - 2, bottom)} Q ${point(x + width * .4, bottom + 3 * drift)} ${point(x + width + 2, bottom - drift)}`;
}

export type Connection = { line: string; head: string; from: Point; to: Point };

function curve(from: Point, c1: Point, c2: Point, to: Point): Connection {
  const angle = Math.atan2(to.y - c2.y, to.x - c2.x);
  const size = Math.min(9, Math.hypot(to.x - from.x, to.y - from.y) * .4);
  const wing = (offset: number) => point(to.x - size * Math.cos(angle + offset), to.y - size * Math.sin(angle + offset));
  return {
    line: `M ${point(from.x, from.y)} C ${point(c1.x, c1.y)} ${point(c2.x, c2.y)} ${point(to.x, to.y)}`,
    head: `M ${wing(-.5)} L ${point(to.x, to.y)} L ${wing(.5)}`,
    from, to,
  };
}

export function connector(from: Point, to: Point, seed = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const bend = Math.min(36, distance * .18) * (seed % 2 ? 1 : -1);
  const c1 = horizontal ? { x: from.x + dx * .45, y: from.y + bend } : { x: from.x + bend, y: from.y + dy * .45 };
  const c2 = horizontal ? { x: to.x - dx * .28, y: to.y - bend } : { x: to.x - bend, y: to.y - dy * .28 };
  return curve(from, c1, c2, to);
}

export type MarkKind = "circle" | "underline" | "outline";

// These points follow the sketch paths, including their seeded asymmetry.
export function markAnchors(target: Box, kind: MarkKind | undefined, seed: number): Point[] {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const drift = seed % 2 ? 1 : -1;
  if (kind === "underline") {
    return [
      { x: target.x - 2, y: target.y + target.height + 2 },
      { x: target.x + target.width + 2, y: target.y + target.height + 2 - drift },
    ];
  }
  if (kind === "circle") {
    return [
      { x: target.x + target.width + 5, y: cy + drift * 1.5 },
      { x: cx - 2, y: target.y + target.height + 3 },
      { x: target.x - 5, y: cy },
      { x: cx + 1, y: target.y - 3 },
    ];
  }
  const padding = kind === "outline" ? 5 : 0;
  const vertical = kind === "outline" ? 3 : 0;
  return [
    { x: target.x + target.width + padding + (kind ? drift / 2 : 0), y: cy },
    { x: cx, y: target.y + target.height + vertical + (kind ? drift * .45 : 0) },
    { x: target.x - padding - (kind ? drift / 2 : 0), y: cy },
    { x: cx, y: target.y - vertical - (kind ? drift * .5 : 0) },
  ];
}

export function overlap(a: Box, b: Box) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

export function placeNote(
  target: Box, context: Box, size: { width: number; height: number },
  viewport: { width: number; height: number }, occupied: Box[], protectedAreas: Box[],
) {
  const gap = 42;
  const inset = 18;
  const y = target.y + target.height / 2 - size.height / 2;
  const positions = [
    { x: context.x + context.width + gap, y },
    { x: context.x - size.width - gap, y },
    { x: context.x + context.width + gap + size.width + 36, y },
    { x: target.x + target.width + gap, y },
    { x: target.x - size.width - gap, y },
    { x: target.x + target.width / 2 - size.width / 2, y: target.y + target.height + gap },
    { x: target.x + target.width / 2 - size.width / 2, y: target.y - size.height - gap },
  ];
  const candidates = positions.flatMap((position, index) => [0, -size.height - 20, size.height + 20].map((offset) => {
    const box = { ...size, x: clamp(position.x, inset, viewport.width - size.width - inset), y: clamp(position.y + offset, inset, viewport.height - size.height - 76) };
    const noteOverlap = occupied.reduce((sum, note) => sum + overlap(box, { x: note.x - 16, y: note.y - 16, width: note.width + 32, height: note.height + 32 }), 0);
    const textOverlap = protectedAreas.reduce((sum, area) => sum + overlap(box, area), 0);
    const displacement = Math.abs(box.x - position.x) + Math.abs(box.y - y);
    return { box, noteOverlap, textOverlap, score: noteOverlap * 1000 + textOverlap * 20 + displacement + index * 10 };
  }));
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]!;
}

function curveHits(from: Point, c1: Point, c2: Point, to: Point, obstacle: Box, padding: number) {
  const left = obstacle.x - padding;
  const right = obstacle.x + obstacle.width + padding;
  const top = obstacle.y - padding;
  const bottom = obstacle.y + obstacle.height + padding;
  if (Math.max(from.x, c1.x, c2.x, to.x) < left || Math.min(from.x, c1.x, c2.x, to.x) > right ||
      Math.max(from.y, c1.y, c2.y, to.y) < top || Math.min(from.y, c1.y, c2.y, to.y) > bottom) return false;
  for (let step = 1; step < 40; step++) {
    const t = step / 40;
    const u = 1 - t;
    const x = u ** 3 * from.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * to.x;
    const y = u ** 3 * from.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * to.y;
    if (x > left && x < right && y > top && y < bottom) return true;
  }
  return false;
}

export function routeConnector(
  note: Box, target: Box, obstacles: Box[], seed: number,
  kind?: MarkKind, textObstacles: Box[] = [],
): Connection {
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const noteCenter = { x: note.x + note.width / 2, y: note.y + note.height / 2 };
  const horizontal = Math.abs(center.x - noteCenter.x) / note.width > Math.abs(center.y - noteCenter.y) / note.height;
  const anchors = markAnchors(target, kind, seed);
  const side = center.x < noteCenter.x ? note.x : note.x + note.width;
  const exits = horizontal
    ? [.5, .25, .75, .1, .9].map((fraction) => ({ x: side, y: note.y + note.height * fraction }))
    : [.5, .25, .75].map((fraction) => ({ x: note.x + note.width * fraction, y: center.y < noteCenter.y ? note.y : note.y + note.height }));
  const lanes = [target.y - 3, target.y + target.height + 3, center.y + (seed % 2 ? 22 : -22),
    ...obstacles.flatMap((obstacle) => [obstacle.y - 18, obstacle.y + obstacle.height + 18])];
  const candidates = exits.flatMap((from, index) => anchors.flatMap((to) => lanes.map((lane) => {
    const c1 = horizontal ? { x: from.x + (to.x - from.x) * .4, y: lane }
      : { x: from.x, y: from.y + (to.y - from.y) * .45 };
    const c2 = horizontal ? { x: to.x - (to.x - from.x) * .12, y: lane }
      : { x: to.x, y: to.y - (to.y - from.y) * .25 };
    const hits = obstacles.filter((obstacle) => curveHits(from, c1, c2, to, obstacle, 8)).length;
    const words = textObstacles.filter((obstacle) => curveHits(from, c1, c2, to, obstacle, 0)).length;
    const length = Math.hypot(from.x - c1.x, from.y - c1.y) + Math.hypot(c1.x - c2.x, c1.y - c2.y) + Math.hypot(c2.x - to.x, c2.y - to.y);
    const oppositeEdge = horizontal && (noteCenter.x > center.x
      ? to.x < center.x - target.width * .2 : to.x > center.x + target.width * .2);
    return { from, c1, c2, to, score: hits * 100000 + (oppositeEdge ? 5000 : 0) + words * 600 + length + index * 3 };
  })));
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0]!;
  return curve(best.from, best.c1, best.c2, best.to);
}
