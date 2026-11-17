import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { resolveTab, withExtensionWorld } from "../src/cdp.ts";
import { pageSnapshotSchema, type PageRequest } from "../src/protocol.ts";

type DomNode = {
  nodeId: number;
  nodeName: string;
  nodeValue: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
};
const connectionAudit = `function() {
  const root = this;
  return [...root.querySelectorAll('.drawing > g')].flatMap(group => {
    const line = group.querySelector('.connector');
    const mark = group.querySelector('.mark');
    if (getComputedStyle(group).display === 'none' || !line.getAttribute('d')) return [];
    const index = group.dataset.annotationIndex;
    const note = root.querySelector('.note[data-annotation-index="' + index + '"]');
    const from = line.getPointAtLength(0);
    const to = line.getPointAtLength(line.getTotalLength());
    const bounds = note.getBoundingClientRect();
    let targetDistance = Infinity;
    const length = mark.getTotalLength();
    for (let distance = 0; distance <= length; distance += .5) {
      const p = mark.getPointAtLength(distance);
      targetDistance = Math.min(targetDistance, Math.hypot(to.x - p.x, to.y - p.y));
    }
    const sourceDistance = Math.min(Math.abs(from.x - bounds.left), Math.abs(from.x - bounds.right),
      Math.abs(from.y - bounds.top), Math.abs(from.y - bounds.bottom));
    const markerNumber = group.querySelector('.badge text').textContent;
    const noteNumber = note.querySelector('.note-index text').textContent;
    return [{ targetDistance, sourceDistance, paired: markerNumber === noteNumber }];
  });
}`;

const chromePath = process.env.JEV_SPOTLIGHT_TEST_CHROME;

test("ten ranked posts keep ten separate explanations and reject stale batches atomically", { skip: !chromePath }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><style>body{font:16px system-ui}table{width:70%}td{padding:12px}</style>
      <table><tbody><tr><td><table><tbody>${Array.from({ length: 12 }, (_, i) => `
      <tr id="story-${i + 1}"><td>${i + 1}.</td><td><a href="/vote?id=${i + 1}"></a></td>
      <td class="titleline"><a href="https://example.com/story-${i + 1}">Story ${i + 1}</a></td></tr>
      <tr><td></td><td></td><td>100 points | 20 comments</td></tr>`).join("")}</tbody></table></td></tr></tbody></table>
      <div><font id="legacy-article">Founders use manual <b>user</b> recruitment to learn.<br><br>
      The second paragraph explains a different idea.<br><br>The final paragraph stays independent.</font></div>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const profile = await mkdtemp(join(tmpdir(), "jev-batch-test-"));
  const child = spawn(chromePath!, ["--headless", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", "--remote-debugging-port=0", "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  try {
    const input = child.stdio[3]!;
    const output = child.stdio[4]!;
    assert("write" in input && "setEncoding" in output);
    output.setEncoding("utf8");
    const extensionId = await new Promise<string>((resolveId, reject) => {
      const timer = setTimeout(() => reject(new Error("Extension installation timed out")), 10000);
      let buffer = "";
      output.on("data", (chunk: string) => {
        buffer += chunk;
        const end = buffer.indexOf("\0");
        if (end < 0) return;
        clearTimeout(timer);
        const reply = JSON.parse(buffer.slice(0, end));
        if (reply.error) reject(new Error(reply.error.message));
        else resolveId(reply.result.id);
      });
      input.write(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: resolve(".output/chrome-mv3") } }) + "\0");
    });
    let port;
    for (let i = 0; i < 50 && !port; i++) {
      port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then((s) => s.split("\n")[0]).catch(() => undefined);
      if (!port) await delay(100);
    }
    assert(port, "Chrome exposes its debugging port");
    const cdpUrl = `http://127.0.0.1:${port}`;
    const target = await resolveTab(cdpUrl, url);
    await withExtensionWorld(cdpUrl, target, extensionId, async ({ evaluate }) => {
      const call = (request: PageRequest) => evaluate(`globalThis.__jevSpotlight(${JSON.stringify({ id: randomUUID(), url, request })})`);
      const capture = async () => pageSnapshotSchema.parse(await call({ operation: "capture" }));
      const snapshot = await capture();
      const stories = snapshot.targets.filter(({ text }) => /^\d+\.\s*Story/.test(text)).slice(0, 10);
      assert.equal(stories.length, 10);
      assert.equal(stories[0]!.href, "https://example.com/story-1");
      assert.equal(stories[9]!.href, "https://example.com/story-10");
      const legacy = snapshot.targets.filter(({ kind }) => kind === "text");
      assert.equal(legacy.length, 3, "double line breaks become distinct text targets");
      assert.equal(legacy[0]!.text, "Founders use manual user recruitment to learn.");
      const annotations = stories.map(({ id }, i) => ({ id, label: `Post ${i + 1}`, explanation: `Separate explanation ${i + 1}`, color: "blue" as const }));
      const result = await call({ operation: "annotate", snapshotId: snapshot.snapshotId, annotations }) as { highlighted: number; annotations: unknown[] };
      assert.equal(result.highlighted, 10);
      assert.equal(result.annotations.length, 10);
      const inspector = new WebSocket(target.webSocketDebuggerUrl!);
      await once(inspector, "open");
      let commandId = 0;
      const inspect = <T = unknown>(method: string, params: object) => new Promise<T>((done, reject) => {
        const id = ++commandId;
        const timer = setTimeout(() => reject(new Error("DOM inspection timed out")), 5000);
        const listener = (event: MessageEvent) => {
          const reply = JSON.parse(event.data);
          if (reply.id !== id) return;
          clearTimeout(timer);
          inspector.removeEventListener("message", listener);
          if (reply.error) reject(new Error(reply.error.message));
          else done(reply.result);
        };
        inspector.addEventListener("message", listener);
        inspector.send(JSON.stringify({ id, method, params }));
      });
      const checkConnections = async () => {
        await inspect("Runtime.evaluate", { expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true });
        const tree = await inspect<{ root: DomNode }>("DOM.getDocument", { depth: -1, pierce: true });
        const findHost = (node: DomNode): DomNode | undefined => node.nodeName === "JEV-SPOTLIGHT-ANNOTATIONS"
          ? node : node.children?.map(findHost).find(Boolean);
        const root = findHost(tree.root)?.shadowRoots?.[0];
        assert(root, "annotation shadow root exists");
        const remote = await inspect<{ object: { objectId: string } }>("DOM.resolveNode", { nodeId: root.nodeId });
        const metrics = await inspect<{ result: { value: { targetDistance: number; sourceDistance: number; paired: boolean }[] } }>("Runtime.callFunctionOn", {
          objectId: remote.object.objectId, functionDeclaration: connectionAudit, returnByValue: true,
        });
        assert(metrics.result.value.length > 0, "at least one visible explanation is connected");
        for (const connection of metrics.result.value) {
          assert(connection.targetDistance < 1.25, `arrow reaches the actual mark, gap ${connection.targetDistance}px`);
          assert(connection.sourceDistance < .15, "connector starts on the note boundary");
          assert(connection.paired, "note and target share the same number");
        }
      };
      try {
        await checkConnections();
        const tree = await inspect<{ root: DomNode }>("DOM.getDocument", { depth: -1, pierce: true });
        const nodes: DomNode[] = [];
        const visit = (node: DomNode) => {
          nodes.push(node);
          for (const child of [...node.children ?? [], ...node.shadowRoots ?? []]) visit(child);
        };
        visit(tree.root);
        const notes = nodes.filter((node) => node.nodeName === "ASIDE");
        assert.equal(notes.length, 10, "all ten explanation cards are rendered");
        for (let i = 1; i <= 10; i++) {
          assert(nodes.some((node) => node.nodeValue === `Separate explanation ${i}`));
        }
        const buttons = nodes.filter((node) => node.nodeName === "BUTTON");
        assert.equal(buttons.length, 13);
        const clearButton = buttons.find((node) => node.children?.some((child) => child.nodeName === "svg") && node.nodeId === buttons.at(-1)?.nodeId);
        assert(clearButton, "the bottom control has a clear button");
        const remote = await inspect<{ object: { objectId: string } }>("DOM.resolveNode", { nodeId: buttons[9]!.nodeId });
        await inspect("Runtime.callFunctionOn", { objectId: remote.object.objectId, functionDeclaration: "function(){this.click()}" });
        assert.equal(await evaluate('(()=>{const r=document.querySelector("#story-10").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()'), true);
        await inspect("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await inspect("Runtime.callFunctionOn", { objectId: remote.object.objectId, functionDeclaration: "function(){this.click()}" });
        await inspect("Runtime.evaluate", { expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true });
        const visibleNotes: { left: number; right: number; top: number; bottom: number }[] = [];
        for (const note of notes) {
          const object = await inspect<{ object: { objectId: string } }>("DOM.resolveNode", { nodeId: note.nodeId });
          const metrics = await inspect<{ result: { value?: { left: number; right: number; top: number; bottom: number } } }>("Runtime.callFunctionOn", {
            objectId: object.object.objectId,
            functionDeclaration: "function(){if(this.hidden)return null;const r=this.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}",
            returnByValue: true,
          });
          if (metrics.result.value) visibleNotes.push(metrics.result.value);
        }
        assert.equal(visibleNotes.length, 1, "narrow view shows one explanation without a rail");
        assert(visibleNotes[0]!.left >= 10 && visibleNotes[0]!.right <= 380);
        assert(visibleNotes[0]!.top >= 10 && visibleNotes[0]!.bottom <= 780);
        await checkConnections();
        await inspect("Emulation.clearDeviceMetricsOverride", {});
        assert.equal(await evaluate('document.querySelectorAll("[data-jev-spotlight-outline]").length'), 10);
        for (let i = 0; i < 30; i++) {
          if (await evaluate('[...document.fonts].some(font => font.family === "Jev Draw" && font.status === "loaded")')) break;
          await delay(100);
        }
        assert.equal(await evaluate('[...document.fonts].some(font => font.family === "Jev Draw" && font.status === "loaded")'), true);
        // Closed shadow roots intentionally hide notes from subsequent page captures.
        const recaptured = await capture();
        assert(!recaptured.targets.some(({ text }) => text.includes("Separate explanation")));
        await assert.rejects(call({ operation: "annotate", snapshotId: snapshot.snapshotId, annotations }), /stale/);
        assert.equal(await evaluate('document.querySelectorAll("[data-jev-spotlight-outline]").length'), 10);
        await evaluate('document.querySelector("#story-5 .titleline a").href="https://example.com/replaced"');
        await assert.rejects(call({ operation: "annotate", snapshotId: recaptured.snapshotId, annotations }), /changed/);
        assert.equal(await evaluate('document.querySelectorAll("[data-jev-spotlight-outline]").length'), 10);
        await assert.rejects(call({ operation: "annotate", snapshotId: recaptured.snapshotId, annotations: [
          { id: legacy[0]!.id, quote: "missing phrase", explanation: "Do not replace the previous marks." },
        ] }), /quoted phrase/);
        assert.equal(await evaluate('document.querySelectorAll("[data-jev-spotlight-outline]").length'), 10);
        const quoted = await call({ operation: "annotate", snapshotId: recaptured.snapshotId, annotations: [
          { id: legacy[0]!.id, quote: "manual user recruitment", shapes: ["circle", "arrow"], explanation: "Talk to users individually to learn what they need." },
          { id: legacy[1]!.id, quote: "different idea", shapes: ["underline", "arrow"], explanation: "This paragraph gets its own explanation." },
        ] }) as { highlighted: number };
        assert.equal(quoted.highlighted, 2, "two ranges in one element remain separate annotations");
        await checkConnections();
        await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
        assert.equal(await evaluate('document.querySelectorAll("[data-jev-spotlight-outline]").length'), 0);
      } finally {
        inspector.close();
      }
    });
  } finally {
    const exit = once(child, "exit");
    child.kill();
    await exit;
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
