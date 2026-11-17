export const annotationStyles = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
    color: #25252b;
    font-family: "Jev Draw", "Segoe Print", "Bradley Hand", cursive;
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent, #4263eb); outline-offset: 5px; border-radius: 3px; }
  .drawing { z-index: 2; position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .mark, .connector, .arrowhead, .note-frame path, .badge path {
    stroke: var(--accent);
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    fill: none;
  }
  .mark { stroke-width: 2.2; pointer-events: stroke; cursor: pointer; }
  .source-port { fill: var(--accent); stroke: white; stroke-width: 1.2; }
  .badge { pointer-events: all; cursor: pointer; }
  :host([data-emphasis]) .drawing > g:not([data-active]) { opacity: .2; }
  :host([data-emphasis]) .note:not([data-active]) { opacity: .45; }
  :host([data-emphasis]) .drawing > g[data-active] .connector { stroke-width: 2.3; opacity: 1; }
  .connector, .arrowhead { stroke-width: 1.8; opacity: .9; }
  .note {
    z-index: 1;
    position: absolute;
    width: min(264px, calc(100vw - 36px));
    max-height: calc(100vh - 112px);
    padding: 17px 19px 19px;
    pointer-events: auto;
    overflow-wrap: anywhere;
    transform: rotate(var(--tilt, -1deg));
    transform-origin: center;
    font-size: 15.5px;
    line-height: 1.5;
    isolation: isolate;
  }
  .note-frame { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; z-index: -1; }
  .note-frame path { fill: var(--paper); stroke-width: 1.6; }
  .note[data-style="text"] .note-frame path { fill: #fff; fill-opacity: .96; stroke: none; }
  .note[data-style="text"] p { color: var(--accent); }
  .note[data-style="bubble"] { padding: 23px 28px 25px; }
  .note button {
    position: relative;
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--accent);
    font-size: 19px;
    font-weight: 600;
    line-height: 1.3;
  }
  .note-index { position: absolute; left: -29px; top: 1px; width: 22px; height: 22px; overflow: visible; }
  .note-index path { fill: white; stroke: var(--accent); stroke-width: 1.6; }
  .note-index text { fill: var(--accent); font: 500 14px "Jev Draw", cursive; text-anchor: middle; dominant-baseline: central; }
  .note p { margin: 9px 0 0; max-height: calc(100vh - 200px); overflow: auto; overscroll-behavior: contain; }
  .note p:first-child { margin-top: 0; }
  .badge path { fill: white; stroke-width: 1.7; }
  .badge text {
    fill: var(--accent);
    font: 500 13px "Jev Draw", "Segoe Print", cursive;
    text-anchor: middle;
    dominant-baseline: central;
  }
  .navigator {
    z-index: 3;
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 32px);
    padding: 7px 9px;
    border: 1px solid #dedee4;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 3px 12px #00000012;
    pointer-events: auto;
    font: 13px / 1.2 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .navigator button { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; padding: 5px; border: 0; border-radius: 6px; background: transparent; }
  .navigator button:hover { background: #f0f1f5; }
  .navigator button:disabled { opacity: .3; cursor: default; }
  .navigator svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .navigator .counter { white-space: nowrap; color: #62626d; font-variant-numeric: tabular-nums; }
  .navigator .name { font-weight: 600; padding: 0 5px; border-right: 1px solid #e9e9ed; }
  .navigator .dismiss { border-left: 1px solid #e9e9ed; border-radius: 0; }
  @media (forced-colors: active) {
    .mark, .connector, .arrowhead, .note-frame path, .badge path { stroke: CanvasText; }
    .note-frame path, .badge path { fill: Canvas; }
    .note, .note button, .badge text { color: CanvasText; fill: CanvasText; }
    .navigator { border-color: CanvasText; background: Canvas; }
  }
`;
