import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTab } from "../src/cdp.ts";

const debuggerOrigin = "http://127.0.0.1:9222";
const url = "https://example.com/?q=one%20two#result";
const target = (id: string) => ({ id, type: "page", url });

test("reuses a matching tab when multiple tabs have the requested URL", async (t) => {
  const requests = t.mock.method(globalThis, "fetch", async () =>
    Response.json([target("first"), target("second")]),
  );

  assert.equal((await resolveTab(debuggerOrigin, url)).id, "first");
  assert.equal(requests.mock.callCount(), 1);
});

test("opens the full requested URL when the browser has no matching tab", async (t) => {
  const requests = t.mock.method(
    globalThis,
    "fetch",
    async (...[input, options]: Parameters<typeof fetch>) => {
      const endpoint = new URL(input as URL);
      if (endpoint.pathname === "/json/list") return Response.json([]);
      assert.equal(endpoint.pathname, "/json/new");
      assert.equal(decodeURIComponent(endpoint.search.slice(1)), url);
      assert.equal(options?.method, "PUT");
      return Response.json(target("new"));
    },
  );

  assert.equal((await resolveTab(debuggerOrigin, url)).id, "new");
  assert.equal(requests.mock.callCount(), 2);
});

test("pins an exact captured tab when duplicate URLs exist", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([target("first"), target("captured")]));
  assert.equal((await resolveTab(debuggerOrigin, url, "captured")).id, "captured");
});

test("rejects a missing or navigated captured tab without opening a replacement", async (t) => {
  const requests = t.mock.method(globalThis, "fetch", async () =>
    Response.json([{ ...target("captured"), url: "https://example.com/other" }]),
  );
  await assert.rejects(resolveTab(debuggerOrigin, url, "captured"), /closed or navigated/);
  await assert.rejects(resolveTab(debuggerOrigin, url, "missing"), /closed or navigated/);
  assert.equal(requests.mock.callCount(), 2);
});
