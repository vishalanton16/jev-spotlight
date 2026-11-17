import { browser } from "wxt/browser";
import { annotationShapes, type Annotation, type HighlightColor } from "../../src/protocol.ts";
import { annotationStyles } from "./annotation-styles.ts";
import { clamp, connector, routeConnector, placeNote, sketchBox, sketchBubble, sketchOval, sketchUnderline, type Box } from "./annotation-geometry.ts";
import { wordRects, type PageAnchor } from "./text-ranges.ts";

const palette: Record<HighlightColor, { ink: string; paper: string }> = {
  red: { ink: "#d12d2d", paper: "#fff1f0" },
  green: { ink: "#087f5b", paper: "#eaf8f0" },
  blue: { ink: "#4263eb", paper: "#eef1ff" },
};
const styles = new CSSStyleSheet();
styles.replaceSync(annotationStyles);
let fontReady: Promise<unknown> | undefined;

function loadDrawFont() {
  return fontReady ??= fetch(browser.runtime.getURL("/fonts/jev-draw.ttf"))
    .then((response) => {
      if (!response.ok) throw new Error("Drawing font could not load.");
      return response.arrayBuffer();
    })
    .then((data) => new FontFace("Jev Draw", data).load())
    .then((font) => document.fonts.add(font))
    .catch(() => undefined);
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, className?: string) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (className) element.classList.add(className);
  return element;
}
const box = (rect: DOMRect): Box => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
const onscreen = (rect: Box, width: number, height: number) => rect.width > 0 && rect.height > 0 &&
  rect.x < width && rect.x + rect.width > 0 && rect.y < height && rect.y + rect.height > 0;

function targetRects(anchor: PageAnchor) {
  const rects = [...(anchor.range ?? anchor.element).getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const merged: Box[] = [];
  for (const rect of rects) {
    const previous = merged.at(-1);
    if (previous && Math.abs(previous.y - rect.top) < 3 && Math.abs(previous.height - rect.height) < 3 && rect.left <= previous.x + previous.width + 5) {
      previous.width = Math.max(previous.x + previous.width, rect.right) - previous.x;
    } else merged.push(box(rect));
  }
  return merged;
}

function createNote(annotation: Annotation, index: number) {
  if (!annotation.label && !annotation.explanation) return;
  const note = document.createElement("aside");
  note.className = "note";
  note.dataset.style = annotation.noteStyle ?? "text";
  note.dataset.annotationIndex = String(index);
  note.setAttribute("role", "note");
  note.style.setProperty("--tilt", `${index % 2 ? .7 : -.7}deg`);
  const frame = svg("svg", "note-frame");
  frame.setAttribute("aria-hidden", "true");
  const border = svg("path");
  frame.append(border);
  note.append(frame);
  const title = document.createElement("button");
  title.type = "button";
  const label = annotation.label || `Note ${index + 1}`;
  title.textContent = label;
  title.setAttribute("aria-label", `${index + 1}. ${label}. Show marked passage`);
  const number = svg("svg", "note-index");
  number.setAttribute("viewBox", "0 0 24 24");
  number.setAttribute("aria-hidden", "true");
  const outline = svg("path");
  outline.setAttribute("d", sketchOval({ x: 2, y: 2, width: 20, height: 20 }, index));
  const digit = svg("text");
  digit.setAttribute("x", "12");
  digit.setAttribute("y", "12");
  digit.textContent = String(index + 1);
  number.append(outline, digit);
  title.prepend(number);
  title.title = "Show the marked passage";
  note.append(title);
  if (annotation.explanation) {
    const text = document.createElement("p");
    text.textContent = annotation.explanation;
    note.append(text);
  }
  return { note, border, title, number };
}

type Item = PageAnchor & { contextRange?: Range; color: HighlightColor; annotation?: Annotation };

export function mountAnnotations(items: Item[], onClear: () => void) {
  const host = document.createElement("jev-spotlight-annotations");
  host.style.visibility = "hidden";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.adoptedStyleSheets = [styles];
  const drawing = svg("svg", "drawing");
  drawing.setAttribute("aria-hidden", "true");
  shadow.append(drawing);
  let active = 0;
  let frame = 0;
  let destroyed = false;
  const wordCache = new Map<HTMLElement | Range, { key: string; rects: Box[] }>();

  function emphasize(index?: number) {
    host.toggleAttribute("data-emphasis", index !== undefined);
    for (const [i, { group, note }] of decorations.entries()) {
      group.toggleAttribute("data-active", i === index);
      note?.note.toggleAttribute("data-active", i === index);
    }
  }

  function select(index: number) {
    active = clamp(index, 0, items.length - 1);
    const item = items[active]!;
    const rect = (item.range ?? item.element).getBoundingClientRect();
    if (rect.top < 40 || rect.bottom > innerHeight - 100) {
      window.scrollBy({ top: rect.top - innerHeight / 3, behavior: "instant" });
    }
    schedule();
  }

  const decorations = items.map((item, index) => {
    const color = palette[item.color];
    const group = svg("g");
    group.dataset.annotationIndex = String(index);
    group.style.setProperty("--accent", color.ink);
    const marks = svg("path", "mark");
    const arrow = svg("path", "connector");
    const head = svg("path", "arrowhead");
    const port = svg("circle", "source-port");
    port.setAttribute("r", "3");
    const badge = svg("g", "badge");
    const badgeOutline = svg("path");
    badgeOutline.setAttribute("d", sketchOval({ x: -10, y: -10, width: 20, height: 20 }, index));
    const number = svg("text");
    number.textContent = String(index + 1);
    badge.append(badgeOutline, number);
    group.append(marks, arrow, head, port, badge);
    group.addEventListener("pointerenter", () => emphasize(index));
    group.addEventListener("pointerleave", () => emphasize());
    badge.addEventListener("click", () => select(index));
    drawing.append(group);
    const note = createNote(item.annotation ?? {}, index);
    if (note) {
      note.note.style.setProperty("--accent", color.ink);
      note.note.style.setProperty("--paper", color.paper);
      note.number.style.display = items.length > 1 ? "" : "none";
      note.title.addEventListener("click", () => select(index));
      note.note.addEventListener("pointerenter", () => emphasize(index));
      note.note.addEventListener("pointerleave", () => {
        if (!note.note.matches(":focus-within")) emphasize();
      });
      note.note.addEventListener("focusin", () => emphasize(index));
      note.note.addEventListener("focusout", () => emphasize());
      shadow.append(note.note);
    }
    return { ...item, shapes: annotationShapes(item.annotation), group, marks, arrow, head, port, badge, note };
  });
  active = Math.max(0, decorations.findIndex(({ note }) => note));

  const navigator = document.createElement("nav");
  navigator.className = "navigator";
  navigator.setAttribute("aria-label", "Page annotations");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = "Jev";
  navigator.append(name);
  function iconButton(label: string, path: string, action: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    const icon = svg("svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const line = svg("path");
    line.setAttribute("d", path);
    icon.append(line);
    button.append(icon);
    button.addEventListener("click", action);
    navigator.append(button);
    return button;
  }
  const previous = iconButton("Previous explanation", "M14 6L8 12L14 18", () => select(active - 1));
  const counter = document.createElement("span");
  counter.className = "counter";
  counter.setAttribute("aria-live", "polite");
  navigator.append(counter);
  const next = iconButton("Next explanation", "M10 6L16 12L10 18", () => select(active + 1));
  iconButton("Clear annotations", "M6 6L18 18M18 6L6 18", onClear).className = "dismiss";
  shadow.append(navigator);
  document.documentElement.append(host);

  function layout() {
    frame = 0;
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const measured = decorations.map((decoration) => {
      const rects = targetRects(decoration);
      const bounds = box((decoration.range ?? decoration.element).getBoundingClientRect());
      const context = box((decoration.element.closest("p,li,td,article,section") ?? decoration.element).getBoundingClientRect());
      return { ...decoration, rects, bounds, context, visible: decoration.element.isConnected && onscreen(bounds, viewport.width, viewport.height) };
    });
    const protectedAreas = measured.filter(({ visible }) => visible).map(({ context }) => context);
    const occupied: Box[] = [];
    const placements = new Map<number, Box>();
    // Lay out the selected explanation first; other notes use only available whitespace.
    const order = [active, ...measured.map((_, index) => index).filter((index) => index !== active)];
    for (const index of order) {
      const entry = measured[index]!;
      if (!entry.note) continue;
      const { note, border } = entry.note;
      note.hidden = false;
      let position: Box | undefined;
      const size = { width: note.offsetWidth, height: note.offsetHeight };
      if (entry.visible && (viewport.width >= 680 || index === active)) {
        const placement = placeNote(entry.bounds, entry.context, size, viewport, occupied, protectedAreas);
        if (viewport.width < 680) {
          position = { ...size, x: (viewport.width - size.width) / 2, y: viewport.height - size.height - 80 };
        } else if (index === active || (placement.noteOverlap === 0 && placement.textOverlap === 0)) {
          position = placement.box;
        }
      }
      note.hidden = !position;
      if (!position) continue;
      note.style.left = `${position.x}px`;
      note.style.top = `${position.y}px`;
      border.setAttribute("d", entry.annotation?.noteStyle === "bubble"
        ? sketchBubble({ x: 0, y: 0, ...size }) : sketchBox({ x: 0, y: 0, ...size }, index));
      placements.set(index, position);
      occupied.push(position);
    }
    const textObstacles = measured.filter(({ visible }) => visible).flatMap((entry) => {
      const source = entry.contextRange ?? entry.element;
      const bounds = source.getBoundingClientRect();
      const key = `${bounds.x + scrollX},${bounds.y + scrollY},${bounds.width},${bounds.height},${getComputedStyle(entry.element).font}`;
      let cached = wordCache.get(source);
      if (cached?.key !== key) {
        const rects = wordRects({ element: entry.element, range: entry.contextRange }).map((rect) => ({
          x: rect.x + scrollX, y: rect.y + scrollY + 2, width: rect.width, height: Math.max(1, rect.height - 4),
        }));
        cached = { key, rects };
        wordCache.set(source, cached);
      }
      return cached.rects.map((rect) => ({ ...rect, x: rect.x - scrollX, y: rect.y - scrollY }))
        .filter((rect) => onscreen(rect, viewport.width, viewport.height));
    });
    for (const [index, entry] of measured.entries()) {
      const { group, marks, arrow, head, port, badge, shapes, visible, rects } = entry;
      group.style.display = visible ? "" : "none";
      if (!visible) continue;
      const paths: string[] = [];
      for (const rect of rects) {
        if (!onscreen(rect, viewport.width, viewport.height)) continue;
        const expanded = { x: rect.x - 5, y: rect.y - 3, width: rect.width + 10, height: rect.height + 6 };
        if (shapes.includes("circle")) paths.push(sketchOval(expanded, index));
        if (shapes.includes("outline")) paths.push(sketchBox(expanded, index));
        if (shapes.includes("underline")) paths.push(sketchUnderline(rect, index));
      }
      marks.setAttribute("d", paths.join(" "));
      const first = rects.find((rect) => onscreen(rect, viewport.width, viewport.height)) ?? entry.bounds;
      badge.style.display = items.length > 1 && entry.note ? "" : "none";
      badge.setAttribute("transform", `translate(${clamp(Math.min(first.x, entry.context.x) - 19, 12, viewport.width - 12)} ${clamp(first.y + first.height / 2, 12, viewport.height - 12)})`);
      const position = placements.get(index);
      arrow.setAttribute("d", "");
      head.setAttribute("d", "");
      port.style.display = "none";
      if (!shapes.includes("arrow")) continue;
      if (!position) {
        if (!entry.note) {
          const to = { x: first.x + first.width / 2, y: first.y - 5 };
          const path = connector({ x: to.x + 30, y: Math.max(12, to.y - 38) }, to, index);
          arrow.setAttribute("d", path.line);
          head.setAttribute("d", path.head);
        }
        continue;
      }
      const target = rects.reduce((nearest, rect) => Math.abs(rect.y - position.y) < Math.abs(nearest.y - position.y) ? rect : nearest, first);
      const obstacles = [...placements.entries()].filter(([other]) => other !== index).map(([, note]) => note);
      const kind = shapes.includes("circle") ? "circle" : shapes.includes("underline") ? "underline"
        : shapes.includes("outline") ? "outline" : undefined;
      const noteBounds = box(entry.note!.note.getBoundingClientRect());
      const path = routeConnector(noteBounds, target, obstacles, index, kind, textObstacles);
      port.setAttribute("cx", String(path.from.x));
      port.setAttribute("cy", String(path.from.y));
      port.style.display = "";
      arrow.setAttribute("d", path.line);
      head.setAttribute("d", path.head);
    }
    counter.textContent = `${active + 1} of ${items.length}`;
    previous.disabled = active === 0;
    next.disabled = active === items.length - 1;
    host.style.visibility = "visible";
  }
  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(layout);
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(document.documentElement);
  for (const { element, note } of decorations) {
    observer.observe(element);
    if (note) observer.observe(note.note);
  }
  addEventListener("resize", schedule);
  addEventListener("scroll", schedule, { capture: true, passive: true });
  void loadDrawFont().then(schedule);
  schedule();

  return () => {
    destroyed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    removeEventListener("resize", schedule);
    removeEventListener("scroll", schedule, true);
    host.remove();
  };
}
