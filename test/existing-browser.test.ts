import assert from "node:assert/strict";
import { test } from "node:test";
import { debuggingBrowsers, localCdpUrl, selectBrowser, existingSession } from "../src/existing-browser.ts";

const url = "https://example.com/";
const browser = (port: number, id: string, stagehand = true, pageUrl = url) => ({
  cdpUrl: `http://127.0.0.1:${port}`,
  stagehand,
  websocket: `ws://127.0.0.1:${port}/devtools/browser/test`,
  tabs: [{ id, type: "page", url: pageUrl }],
});

test("discovers local debugging ports without using child renderers or non-debuggable Chrome", () => {
  assert.deepEqual(debuggingBrowsers([
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=5555 --user-data-dir=/tmp/stagehand-chrome-test",
    "/usr/bin/chromium --type=renderer --remote-debugging-port=5555",
    "/usr/bin/google-chrome --remote-debugging-port=0",
    "/usr/bin/google-chrome --remote-debugging-port=99999",
    "/usr/bin/chromium --remote-debugging-port=6666 --user-data-dir=/tmp/custom-profile",
  ].join("\n")), [
    { cdpUrl: "http://127.0.0.1:5555", stagehand: true },
    { cdpUrl: "http://127.0.0.1:6666", stagehand: false },
  ]);
});

test("prefers the existing Stagehand page over a duplicate in Jev's saved browser", () => {
  const saved = browser(1111, "jev", false);
  const stagehand = browser(2222, "stagehand");
  const unrelated = browser(3333, "other", true, "https://example.org/");
  assert.equal(selectBrowser([saved, unrelated, stagehand], url, undefined, saved.cdpUrl), stagehand);
  assert.equal(selectBrowser([saved, stagehand], url, "jev", saved.cdpUrl), saved);
});

test("reuses a single Stagehand browser for a new URL but never guesses between matching sessions", () => {
  const saved = browser(1111, "jev", false, "about:blank");
  const stagehand = browser(2222, "stagehand", true, "about:blank");
  assert.equal(selectBrowser([saved, stagehand], url, undefined, saved.cdpUrl), stagehand);
  assert.throws(() => selectBrowser([browser(2222, "one"), browser(3333, "two")], url), /Several Chrome/);
  assert.throws(() => selectBrowser([stagehand], url, "closed"), /closed or navigated/);
  assert.equal(selectBrowser([], url), undefined);
});

test("accepts only local debugging origins, without credentials, redirects, or paths", () => {
  assert.equal(localCdpUrl.parse("http://127.0.0.1:9222/"), "http://127.0.0.1:9222");
  for (const endpoint of ["https://example.com:9222", "http://127.0.0.1:9222/private", "http://user:pass@127.0.0.1:9222", "http://127.0.0.1:9222?url=private"]) {
    assert.equal(localCdpUrl.safeParse(endpoint).success, false);
  }
});

test("an unreachable explicitly configured browser fails without launching a replacement", async (t) => {
  const original = process.env.JEV_SPOTLIGHT_CDP_URL;
  process.env.JEV_SPOTLIGHT_CDP_URL = "http://127.0.0.1:9222";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  try {
    await assert.rejects(existingSession(url), /no new browser was opened/);
  } finally {
    if (original === undefined) delete process.env.JEV_SPOTLIGHT_CDP_URL;
    else process.env.JEV_SPOTLIGHT_CDP_URL = original;
  }
});
