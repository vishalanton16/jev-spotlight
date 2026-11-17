export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.allSettled(tabs.filter((tab) => tab.id !== undefined).map(async (tab) => {
      const [probe] = await browser.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () => typeof (globalThis as Record<string, unknown>).__jevSpotlight === "function",
      });
      if (probe && !probe.result && probe.documentId) {
        await browser.scripting.executeScript({
          target: { tabId: tab.id!, documentIds: [probe.documentId] },
          files: ["/content-scripts/page.js"],
        });
      }
    }));
  });
});
