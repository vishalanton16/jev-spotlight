import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { highlightPage, highlightInput, capturePage, captureInput, annotatePage, annotateInput } from "./tools.ts";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (process.env.TYPESAFE_API_KEY === "") delete process.env.TYPESAFE_API_KEY;
if (existsSync(envFile)) process.loadEnvFile(envFile);
const fallbackEnvFile = process.env.JEV_SPOTLIGHT_ENV_FILE;
if (!process.env.TYPESAFE_API_KEY && fallbackEnvFile && existsSync(fallbackEnvFile)) {
  const key = parseEnv(readFileSync(fallbackEnvFile, "utf8")).TYPESAFE_API_KEY;
  if (key) process.env.TYPESAFE_API_KEY = key;
}

async function serveMcp() {
  const server = new McpServer({ name: "jev-spotlight", version: "1.0.0" });
  server.registerTool(
    "highlight_page",
    {
      description:
        "Semantic highlight search using Jev. Each element is scored independently. For exact counts, ordered items, or distinct explanations, use capture_page then annotate_page. Stagehand researches linked content; Jev owns captured target identity and annotation rendering. Reuses existing local Stagehand Chrome when available. If multiple sessions match, configure JEV_SPOTLIGHT_CDP_URL; never launch another browser to work around a connection error. Replaces previous annotations.",
      inputSchema: highlightInput,
    },
    async (args) => {
      try {
        const result = await highlightPage(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            { type: "text", text: error instanceof Error ? error.message : "Highlighting failed." },
          ],
        };
      }
    },
  );
  server.registerTool("capture_page", {
    description: "Capture exact annotation targets, in document order, from Jev Chrome. Returns url, tabId, snapshotId, target IDs, text and story hrefs. For 'explain the first 10 posts', select the ten ranked story targets here, use Stagehand to research these exact hrefs, then call annotate_page once with ten separate explanations. Reuses the existing local Chrome tab where possible. Do not re-read a different browser's front page or recapture during research. For several matching browsers, configure JEV_SPOTLIGHT_CDP_URL instead of launching another browser.",
    inputSchema: captureInput,
  }, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await capturePage(args)) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Capture failed." }] };
    }
  });
  server.registerTool("annotate_page", {
    description: "Render a batch of exact-target annotations from capture_page. Each target gets its own explanation and highlight. For ten posts, pass ten entries in ONE call, each with a distinct item-specific label and explanation. Never attach one group summary to all posts or send ten replacing calls. Agent writes each explanation from Stagehand research of that captured href: state the concrete idea and why it matters in 1–2 short sentences, roughly 15–35 words. Do not repeat generic takeaways or refer to an accompanying summary. For passages, supply an exact short quote and use underline or circle with arrow. Jev validates identities and renders separate handwritten callouts. Does not research or generate explanations. Requires the captured tabId, url and snapshotId. Rejects stale or changed targets before replacing any marks. Returns applied IDs and explanations; verify count equals the user's request.",
    inputSchema: annotateInput,
  }, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await annotatePage(args)) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Annotation failed." }] };
    }
  });
  await server.connect(new StdioServerTransport());
}

async function main() {
  const [url, task, evidence] = process.argv.slice(2);
  if (url === "mcp") return serveMcp();
  if (!url || url === "--help") {
    console.log("pnpm spotlight <url> <what to highlight> [evidence]");
    return;
  }
  const result = await highlightPage(highlightInput.parse({ url, task, evidence }));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Jev Spotlight failed.");
  process.exitCode = 1;
});
