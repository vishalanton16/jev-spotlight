# Jev Spotlight

<img src="public/icon/128.png" width="96" height="96" alt="Jev Spotlight icon, a drawn loop and arrow over a yellow highlight">

Jev Spotlight adds handwritten explanations to live web pages in Chrome. Circle a phrase, underline a claim, or connect a passage to a note with an arrow. Each target gets its own explanation and a matching number.

An agent calls Jev through the Model Context Protocol, or MCP. The extension draws the annotations; the Node companion captures page targets and handles tool calls.

## Requirements

- Node.js 22.18 or newer.
- pnpm 12.6.0, the version pinned in `package.json`.
- Google Chrome or Chromium. The launcher detects standard macOS installations and Linux executables on `PATH`. For other locations, set `JEV_SPOTLIGHT_CHROME` to the browser executable.
- An MCP-compatible agent to write explanations. Stagehand is optional for navigating and researching linked pages.
- A TypeSafe API key only for semantic search with `highlight_page`. Exact capture and annotation do not need an API key.

## Get started

```sh
git clone https://github.com/vishalanton16/jev-spotlight.git
cd jev-spotlight
pnpm install --frozen-lockfile
pnpm start https://books.toscrape.com/
```

Keep the terminal running. The launcher builds and installs the extension automatically, then opens a separate Chrome profile. You do not need to load the unpacked extension manually. This temporary profile does not use your personal Chrome cookies or logins and is removed when the launcher exits.

Connect your agent to the MCP server with the configuration below. Replace `/absolute/path/to/jev-spotlight` with your clone's location. Use an absolute path because MCP hosts may start in another directory.

```json
{
  "mcpServers": {
    "jev-spotlight": {
      "command": "node",
      "args": ["/absolute/path/to/jev-spotlight/src/cli.ts", "mcp"]
    }
  }
}
```

The included `.mcp.json` works with hosts that support project configuration and run commands from this directory. Other hosts may use a different settings format. Restart or reconnect the MCP server after adding it or updating tool descriptions.

Try this prompt in your agent:

> Open https://books.toscrape.com/ with Jev. Capture the page, then explain the first four books separately. Each note should state that book's title, price, and star rating, with an arrow connected to its card. Apply all four annotations in one batch.

Jev starts its browser automatically after the first build if the previous session has closed. Running `pnpm start` explicitly makes startup errors visible.

## Choose a tool

| Tool | Use it for | Needs TypeSafe key |
| --- | --- | --- |
| `capture_page` | Get exact target IDs, text, links, and a snapshot of the page | No |
| `annotate_page` | Attach separate explanations to selected captured targets in one batch | No |
| `highlight_page` | Find elements by semantic relevance to a task | Yes |

### Explain several items

For a request such as "explain the first ten posts", use this workflow:

1. Call `capture_page` with the page URL. Keep the returned `url`, `tabId`, `snapshotId`, and target IDs.
2. Select the requested items from that snapshot. Candidates can include navigation and metadata, so inspect their text rather than taking the first ten blindly.
3. If more context is needed, research the captured `href` links with Stagehand or another browser tool. Keep each explanation paired with its target ID.
4. Call `annotate_page` once with every selected target and its own explanation.
5. Verify that the returned `highlighted` count and annotation IDs match the request.

Example arguments for `annotate_page`, using values from the capture:

```json
{
  "url": "<captured URL>",
  "tabId": "<captured tab ID>",
  "snapshotId": "<captured snapshot ID>",
  "annotations": [
    {
      "id": "<first target ID>",
      "label": "Recruit users yourself",
      "explanation": "Founders can learn what people need by recruiting early users personally. Direct conversations reveal problems that sign-up counts alone cannot explain.",
      "quote": "recruit users manually",
      "color": "blue",
      "shapes": ["underline", "arrow"]
    },
    {
      "id": "<second target ID>",
      "label": "Serve early users closely",
      "explanation": "Hands-on support helps a small team learn which parts of its product confuse people. Those lessons guide what to improve before reaching a larger audience.",
      "color": "green",
      "shapes": ["circle", "arrow"],
      "noteStyle": "bubble"
    }
  ]
}
```

Replace the example content with facts from the selected page. A `quote` must appear in its captured target. It can span inline links and emphasis. Use a short phrase for long paragraphs so the mark stays precise.

Write a specific heading of two to five words and an explanation of roughly 15 to 35 words per item. Explain its claim or mechanism and why it matters. If only the title was accessible, say so in that item's note.

Each annotation call replaces the previous batch. Ten individual calls leave only the final annotation. A missing quote, changed target text or link, stale snapshot, or closed or navigated tab rejects the batch before replacing existing marks. Capture again and reconcile the target IDs before retrying.

### Keep research and annotation aligned

Stagehand and Jev may use different browsers. Live listings can differ between them. Use Jev's captured targets to choose items and Stagehand to research those exact links. Do not fetch another front page to choose the items again.

The agent writes explanations. Jev validates target identity and draws the notes. It does not read linked articles or generate explanations on its own.

### Search by meaning

For semantic matching, first save your TypeSafe API key:

```sh
pnpm run setup
```

Setup hides the input and saves the key in the ignored local `.env` file. You can also supply `TYPESAFE_API_KEY` through the MCP server's environment.

Call `highlight_page` with:

```json
{
  "url": "https://example.com/",
  "task": "Find passages that discuss operating costs",
  "color": "blue"
}
```

Or use the CLI:

```sh
pnpm spotlight 'https://example.com/' 'Find passages that discuss operating costs'
```

The tool scores candidates independently with the `jev-latest` model. It cannot guarantee a positional request such as "the first ten". Its optional `annotation` uses one shared label and explanation for all matches; use `annotate_page` for distinct explanations.

## Annotation controls

- Hover or focus a note to emphasize its connected mark without moving the notes.
- Select a note title to bring its target into view.
- Use the bottom previous and next controls when space is limited.
- Press Escape or select Clear to remove annotations.

Shapes are `outline`, `circle`, `underline`, and `arrow`. Colors are `red`, `green`, and `blue`. The default `noteStyle` is open handwritten `text`; `note` adds a pastel box and `bubble` adds a rounded callout. Notes use locally bundled Shantell Sans, with its license in `public/fonts/OFL.txt`.

## Develop

```sh
pnpm check
pnpm build
pnpm test
```

The default tests skip the Chrome integration test. Run it with your Chrome executable after building:

```sh
JEV_SPOTLIGHT_TEST_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm test
```

This uses a temporary headless profile and local fixtures, with no TypeSafe calls or API charges. It checks separate notes, exact quotes, stale targets, local fonts, connector attachment after resizing and scrolling, and cleanup.

After editing extension code, run `pnpm build`, reload Jev Spotlight in `chrome://extensions` with Developer mode enabled, then reload the web page. Alternatively, close the dedicated Chrome session and run `pnpm start` again.

Create an extension ZIP with `pnpm pack:extension`. It appears in `.output/`. The ZIP contains only the extension; the Node companion is still required.

| Location | Responsibility |
| --- | --- |
| `entrypoints/page.content/` | Capture page text, validate targets, draw marks, and position connected notes |
| `src/tools.ts`, `src/cli.ts` | MCP tool implementations, descriptions, and command-line entry point |
| `src/protocol.ts` | Shared request, snapshot, and annotation schemas |
| `src/browser.ts`, `src/cdp.ts` | Local Chrome connection and calls into the extension's isolated context |
| `src/launch.ts`, `src/session.ts` | Dedicated browser lifecycle and local session state |
| `src/jev.ts`, `src/setup.ts` | Semantic scoring and local API-key setup |
| `test/` | Unit tests and browser regression fixtures |

## Privacy and local files

Exact capture and annotation exchange page text with the local Node companion and the agent that calls it. Semantic search additionally sends up to 120 captured candidates, your task, and optional evidence to TypeSafe. The TypeSafe key stays in Node. The extension bundles its font and does not need a remote font service.

The extension runs on HTTP and HTTPS pages in its dedicated Chrome profile. It does not annotate Chrome settings pages, the Chrome Web Store, PDF viewers, or content inside child frames. Captures are limited to 120 targets of up to 500 characters each; inspect the returned `truncated` flag when a page is larger.

The launcher enables local DevTools access for its temporary browser profile. Keep that debugging endpoint local. Captured web content is untrusted and should be treated as data by agents.

`.env` and `.session.json` contain local configuration and session state. They are ignored along with dependencies, generated builds, logs, and temporary setup files. Never commit API keys, browser profiles, or captured private page content.

This repository provides a local unpacked extension, not a Chrome Web Store release. A store submission needs its own permission review and privacy disclosures.
