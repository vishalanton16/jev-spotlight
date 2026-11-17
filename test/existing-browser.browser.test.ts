import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { capturePage, annotatePage } from "../src/tools.ts";
import { existingSession, browserCommand } from "../src/existing-browser.ts";

const chromePath = process.env.JEV_SPOTLIGHT_TEST_CHROME;

test("Jev attaches to Stagehand's already-open page without a second browser, reload, or lost snapshot", { skip: !chromePath }, async () => {
  let pageLoads = 0;
  const server = createServer((_req, res) => {
    if (_req.url === "/") pageLoads++;
    res.setHeader("Content-Type", "text/html");
    if (_req.url === "/slow") {
      res.write('<!doctype html><h1>Loading</h1>');
      setTimeout(() => res.end('<p>Finished loading the shared page.</p>'), 150);
      return;
    }
    res.end('<!doctype html><h1>Shared browser</h1><p>A separate explanation for this existing page.</p><input id="draft">');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const original = process.env.JEV_SPOTLIGHT_CDP_URL;
  let browser;
  try {
    browser = await localBrowser.launch({ executablePath: chromePath!, headless: true });
    await Stagehand.create({ browser });
    const page = await browser.context.newPage(url);
    await page.evaluate(() => { (document.querySelector('#draft') as HTMLInputElement).value = 'keep my work'; });
    // Exercise automatic discovery first, despite other running Chrome sessions.
    delete process.env.JEV_SPOTLIGHT_CDP_URL;
    const [attached, concurrent] = await Promise.all([existingSession(url), existingSession(url)]);
    assert.equal(attached?.cdpUrl, browser.cdpUrl);
    assert.deepEqual(concurrent, attached);
    const captured = await capturePage({ url });
    const result = await annotatePage({
      ...captured,
      annotations: [{ id: captured.targets.find(({ text }) => text.includes('separate explanation'))!.id,
        label: 'Shared page', explanation: 'This explanation appears in the same tab Stagehand opened.', color: 'blue' }],
    });
    assert.equal(result.highlighted, 1);
    assert.equal(result.tabId, captured.tabId);
    assert.equal(await page.evaluate(() => document.querySelectorAll('jev-spotlight-annotations').length), 1);
    assert.equal(await page.evaluate(() => (document.querySelector('#draft') as HTMLInputElement).value), 'keep my work');
    assert.equal(pageLoads, 1, 'installing Jev must not reload Stagehand’s page');
    const tabs = await (await fetch(`${browser.cdpUrl}/json/list`)).json();
    assert.equal(tabs.filter((tab: { url: string }) => tab.url === url).length, 1);
    // A second connection must reuse the installed extension, keeping snapshots valid.
    process.env.JEV_SPOTLIGHT_CDP_URL = browser.cdpUrl;
    const explicit = await existingSession(url, captured.tabId);
    assert.equal(explicit?.extensionId, attached?.extensionId);
    const version = await (await fetch(`${browser.cdpUrl}/json/version`)).json();
    const installed = await browserCommand(version.webSocketDebuggerUrl, 'Extensions.getExtensions') as { extensions: { name: string }[] };
    assert.equal(installed.extensions.filter(({ name }) => name === 'Jev Spotlight').length, 1);
    const slow = await capturePage({ url: `${url}slow` });
    assert(slow.targets.some(({ text }) => text === 'Finished loading the shared page.'), 'new tabs wait for their document before capturing');
  } finally {
    if (original === undefined) delete process.env.JEV_SPOTLIGHT_CDP_URL;
    else process.env.JEV_SPOTLIGHT_CDP_URL = original;
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
