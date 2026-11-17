export type PageAnchor = { element: HTMLElement; range?: Range };

export const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();

export function anchorText({ element, range }: PageAnchor) {
  const text = range ? range.toString()
    : element instanceof HTMLImageElement ? element.alt
    : element.getAttribute("aria-label") || element.innerText || "";
  return normalizeText(text).slice(0, 500);
}

// Older articles use double line breaks instead of paragraph elements.
export function paragraphRanges(element: HTMLElement) {
  const nodes = [...element.childNodes];
  const ranges: Range[] = [];
  let start = 0;
  const append = (end: number) => {
    if (end <= start) return;
    const range = document.createRange();
    range.setStart(element, start);
    range.setEnd(element, end);
    if (normalizeText(range.toString())) ranges.push(range);
  };
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]?.nodeName !== "BR") continue;
    let end = i + 1;
    while (end < nodes.length && (nodes[end]?.nodeName === "BR" || !nodes[end]?.textContent?.trim())) end++;
    if (!nodes.slice(i + 1, end).some((node) => node.nodeName === "BR")) continue;
    append(i);
    start = end;
    i = end - 1;
  }
  append(nodes.length);
  return ranges;
}

export function quoteRange(anchor: PageAnchor, quote: string) {
  const scope = anchor.range ?? document.createRange();
  if (!anchor.range) scope.selectNodeContents(anchor.element);
  const walker = document.createTreeWalker(anchor.element, NodeFilter.SHOW_TEXT);
  const positions: { node: Text; offset: number }[] = [];
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!scope.intersectsNode(node)) continue;
    const content = node as Text;
    const start = node === scope.startContainer ? scope.startOffset : 0;
    const end = node === scope.endContainer ? scope.endOffset : content.length;
    for (let offset = start; offset < end; offset++) {
      const character = /\s/.test(content.data[offset]!) ? " " : content.data[offset]!;
      if (character === " " && (!text || text.endsWith(" "))) continue;
      text += character;
      positions.push({ node: content, offset });
    }
  }
  const normalized = normalizeText(quote);
  const index = text.indexOf(normalized);
  if (index < 0) throw new Error("The quoted phrase is missing from its target. Capture the page again.");
  const first = positions[index]!;
  const last = positions[index + normalized.length - 1]!;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

export function wordRects({ element, range }: PageAnchor) {
  const scope = range ?? document.createRange();
  if (!range) scope.selectNodeContents(element);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  let node: Node | null;
  let words = 0;
  while ((node = walker.nextNode()) && words < 300) {
    if (!scope.intersectsNode(node) || node.parentElement?.closest("script,style,noscript")) continue;
    const text = node as Text;
    const start = node === scope.startContainer ? scope.startOffset : 0;
    const end = node === scope.endContainer ? scope.endOffset : text.length;
    for (const match of text.data.slice(start, end).matchAll(/\S+/g)) {
      const word = document.createRange();
      word.setStart(text, start + match.index);
      word.setEnd(text, start + match.index + match[0].length);
      rects.push(...word.getClientRects());
      if (++words >= 300) break;
    }
  }
  return rects;
}
