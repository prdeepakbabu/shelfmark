import assert from "node:assert/strict";

import {
  PROJECTS_KEY,
  STORAGE_KEY,
  classifyUrl,
  normalizeUrl,
  sortBookmarks
} from "../shared.js";

const storageData = {
  [STORAGE_KEY]: [],
  [PROJECTS_KEY]: []
};

const captures = [];
const runtimeListeners = {
  installed: [],
  message: []
};

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, clone(storageData[key])]));
        }

        if (typeof keys === "string") {
          return { [keys]: clone(storageData[keys]) };
        }

        if (keys && typeof keys === "object") {
          return Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [
              key,
              key in storageData ? clone(storageData[key]) : fallback
            ])
          );
        }

        return clone(storageData);
      },
      async set(value) {
        for (const [key, entry] of Object.entries(value)) {
          storageData[key] = clone(entry);
        }
      }
    },
    onChanged: {
      addListener() {}
    }
  },
  runtime: {
    onInstalled: {
      addListener(listener) {
        runtimeListeners.installed.push(listener);
      }
    },
    onMessage: {
      addListener(listener) {
        runtimeListeners.message.push(listener);
      }
    }
  },
  tabs: {
    async create() {
      return { id: 1 };
    },
    async captureVisibleTab(windowId, options) {
      captures.push({ windowId, options });
      return "data:image/jpeg;base64,fake-capture";
    }
  }
};

globalThis.fetch = async (url) => {
  switch (url) {
    case "https://example.com/article":
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <title>Systems Thinking for Agents</title>
            <meta name="description" content="A practical guide to agent workflows.">
            <meta property="og:type" content="article">
            <meta property="og:site_name" content="Example Research">
          </head>
          <body>
            <main>
              <article>
                <h1>Systems Thinking for Agents</h1>
                <p>This article explains how to break down agentic systems into loops, tools, and memory.</p>
                <p>It also describes practical tradeoffs when you are organizing knowledge for projects.</p>
              </article>
            </main>
          </body>
        </html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    case "https://example.com/paper.pdf": {
      const pdfLikeText = `%PDF-1.4
        1 0 obj << /Type /Page >>
        stream
        (Large language models can synthesize and reason across documents.)
        (This PDF focuses on retrieval and memory systems for research workflows.)
        endstream
        endobj`;
      return new Response(pdfLikeText, {
        status: 200,
        headers: { "content-type": "application/pdf" }
      });
    }
    case "https://x.com/i/articles/123":
      return new Response(
        `<!doctype html>
        <html>
          <head><title>X</title></head>
          <body>
            <main>
              <p>We’ve detected that JavaScript is disabled in this browser.</p>
              <p>Please enable JavaScript or switch to a supported browser to continue using x.com.</p>
              <p>Something went wrong, but don’t fret — let’s give it another shot.</p>
            </main>
          </body>
        </html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    case "https://x.com/deepak/status/456":
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <title>Deepak on X</title>
            <meta property="og:title" content="Deepak on X">
            <meta property="og:description" content="A post about ranking research links by popularity.">
          </head>
          <body>
            <article>
              <button data-testid="like" aria-label="128 Likes. Like"></button>
              <button data-testid="retweet" aria-label="23 Reposts. Repost"></button>
              <p>Ranking research links by popularity gives you a quick signal for what is resonating.</p>
            </article>
          </body>
        </html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    case "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Ddemo123&format=json":
      return new Response(
        JSON.stringify({
          title: "Agent Orchestration Deep Dive",
          author_name: "Shelfmark Lab",
          thumbnail_url: "https://i.ytimg.com/vi/demo123/hqdefault.jpg"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    case "https://www.youtube.com/watch?v=demo123":
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <title>Agent Orchestration Deep Dive - YouTube</title>
            <meta property="og:title" content="Agent Orchestration Deep Dive">
            <meta name="description" content="A walkthrough of orchestrating agent teams, harnesses, and coordination loops.">
            <meta property="og:description" content="A walkthrough of orchestrating agent teams, harnesses, and coordination loops.">
            <meta property="og:image" content="https://i.ytimg.com/vi/demo123/maxresdefault.jpg">
            <meta property="og:site_name" content="YouTube">
            <meta property="og:type" content="video.other">
            <meta itemprop="duration" content="PT42M12S">
            <script type="application/ld+json">{"interactionStatistic":[{"interactionType":{"@type":"http://schema.org/LikeAction"},"userInteractionCount":"12500"}]}</script>
            <script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"A walkthrough of orchestrating agent teams, harnesses, and coordination loops. This version includes the longer description text that should be preserved for export rather than being truncated in the UI card."}};</script>
            <script>var ytInitialData = {"topLevelButtons":[{"segmentedLikeDislikeButtonViewModel":{"likeButtonViewModel":{"likeButtonViewModel":{"toggleButtonViewModel":{"toggleButtonViewModel":{"defaultButtonViewModel":{"buttonViewModel":{"accessibilityText":"12.5K likes"}}}}}}}]};</script>
          </head>
          <body>
            <main>
              <p>Ignore generic boilerplate and prefer the metadata description for export.</p>
            </main>
          </body>
        </html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    default:
      throw new Error(`Unexpected fetch URL in test: ${url}`);
  }
};

await import("../background.js");

for (const listener of runtimeListeners.installed) {
  await listener();
}

const [messageListener] = runtimeListeners.message;

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out waiting for ${type} response.`));
      }
    }, 2000);

    const maybeAsync = messageListener({ type, payload }, {}, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });

    if (maybeAsync !== true && !settled) {
      clearTimeout(timer);
      reject(new Error(`Message listener for ${type} did not stay alive.`));
    }
  });
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await run("normalizeUrl removes tracking parameters and hashes", async () => {
  assert.equal(
    normalizeUrl("https://example.com/path/?utm_source=x&keep=yes#section"),
    "https://example.com/path?keep=yes"
  );
});

await run("classifyUrl identifies core content kinds", async () => {
  assert.deepEqual(classifyUrl("https://x.com/i/articles/123").tags, ["article", "x"]);
  assert.equal(classifyUrl("https://youtu.be/demo").contentType, "video");
  assert.equal(classifyUrl("https://example.com/file.pdf").contentType, "pdf");
});

await run("bookmark, project, screenshot, and export flow works through the background message API", async () => {
  const bookmarkResponse = await sendMessage("SAVE_BOOKMARK", {
    url: "https://example.com/article",
    notes: "Use this for the multi-agent architecture draft.",
    metadata: {}
  });

  assert.equal(bookmarkResponse.ok, true);
  assert.equal(bookmarkResponse.status, "created");
  assert.equal(bookmarkResponse.bookmark.title, "Systems Thinking for Agents");
  assert.ok(bookmarkResponse.bookmark.tags.includes("article"));
  assert.ok(bookmarkResponse.bookmark.tags.includes("blog"));

  const projectResponse = await sendMessage("UPSERT_PROJECT", {
    name: "Agent architecture",
    description: "Collected sources for designing an agent system.",
    learnings: "Start with tool boundaries.\n\nPrefer small loops."
  });

  assert.equal(projectResponse.ok, true);
  assert.equal(projectResponse.project.name, "Agent architecture");

  const assignResponse = await sendMessage("ASSIGN_BOOKMARKS_TO_PROJECT", {
    projectId: projectResponse.project.id,
    bookmarkIds: [bookmarkResponse.bookmark.id]
  });
  assert.equal(assignResponse.ok, true);

  const captureResponse = await sendMessage("CAPTURE_VISIBLE_TAB", { windowId: 99 });
  assert.equal(captureResponse.ok, true);
  assert.equal(captureResponse.dataUrl, "data:image/jpeg;base64,fake-capture");
  assert.equal(captures.length, 1);

  const addImageResponse = await sendMessage("ADD_PROJECT_IMAGE", {
    projectId: projectResponse.project.id,
    image: {
      name: "Agent loop sketch",
      caption: "Initial scratch",
      dataUrl: captureResponse.dataUrl
    }
  });
  assert.equal(addImageResponse.ok, true);

  const exportResponse = await sendMessage("EXPORT_PROJECT", {
    projectId: projectResponse.project.id
  });

  assert.equal(exportResponse.ok, true);
  assert.equal(exportResponse.fileName, "agent-architecture-export.html");
  assert.match(exportResponse.html, /Agent architecture/);
  assert.match(exportResponse.html, /Start with tool boundaries\./);
  assert.match(exportResponse.html, /Systems Thinking for Agents/);
  assert.match(exportResponse.html, /Reference URL/);
  assert.match(exportResponse.html, /This article explains how to break down agentic systems/);
  assert.match(exportResponse.html, /Print \/ Save as PDF/);
  assert.match(exportResponse.html, /#autoprint/);
});

await run("PDF bookmark metadata and project cleanup work", async () => {
  const bookmarkResponse = await sendMessage("SAVE_BOOKMARK", {
    url: "https://example.com/paper.pdf",
    notes: "Read the retrieval section.",
    metadata: {}
  });

  assert.equal(bookmarkResponse.ok, true);
  assert.equal(bookmarkResponse.bookmark.contentType, "pdf");
  assert.equal(bookmarkResponse.bookmark.pageCount, 1);

  const projectResponse = await sendMessage("UPSERT_PROJECT", {
    name: "PDF review",
    description: "Paper collection"
  });

  await sendMessage("ASSIGN_BOOKMARKS_TO_PROJECT", {
    projectId: projectResponse.project.id,
    bookmarkIds: [bookmarkResponse.bookmark.id]
  });

  await sendMessage("DELETE_BOOKMARK", { id: bookmarkResponse.bookmark.id });

  const stored = await chrome.storage.local.get([STORAGE_KEY, PROJECTS_KEY]);
  assert.equal(stored[STORAGE_KEY].some((item) => item.id === bookmarkResponse.bookmark.id), false);
  const refreshedProject = stored[PROJECTS_KEY].find((item) => item.id === projectResponse.project.id);
  assert.deepEqual(refreshedProject.bookmarkIds, []);
});

await run("X export falls back to cached page text instead of blocked fallback html", async () => {
  const bookmarkResponse = await sendMessage("SAVE_BOOKMARK", {
    url: "https://x.com/i/articles/123",
    notes: "Export this using cached text.",
    metadata: {
      title: "Distillation notes on X",
      summary: "A longform X article about model distillation.",
      contentType: "article",
      capturedContent: "Distillation works best when the student target is specific.\n\nMeasure behavior, not just loss.\n\nKeep the evaluation target aligned with the deployment task."
    }
  });

  assert.equal(bookmarkResponse.ok, true);
  assert.ok(bookmarkResponse.bookmark.contentRef);

  const projectResponse = await sendMessage("UPSERT_PROJECT", {
    name: "X export cache",
    description: "Regression case for X export fallback."
  });

  await sendMessage("ASSIGN_BOOKMARKS_TO_PROJECT", {
    projectId: projectResponse.project.id,
    bookmarkIds: [bookmarkResponse.bookmark.id]
  });

  const exportResponse = await sendMessage("EXPORT_PROJECT", {
    projectId: projectResponse.project.id
  });

  assert.equal(exportResponse.ok, true);
  assert.match(exportResponse.html, /Measure behavior, not just loss/);
  assert.match(exportResponse.html, /Keep the evaluation target aligned with the deployment task/);
  assert.doesNotMatch(exportResponse.html, /JavaScript is disabled in this browser/);
});

await run("YouTube bookmarks preserve title description runtime and thumbnail in export", async () => {
  const bookmarkResponse = await sendMessage("SAVE_BOOKMARK", {
    url: "https://www.youtube.com/watch?v=demo123",
    notes: "Important video on agent orchestration.",
    metadata: {}
  });

  assert.equal(bookmarkResponse.ok, true);
  assert.equal(bookmarkResponse.bookmark.title, "Agent Orchestration Deep Dive");
  assert.equal(bookmarkResponse.bookmark.contentType, "video");
  assert.equal(bookmarkResponse.bookmark.runtimeMinutes, 43);
  assert.match(bookmarkResponse.bookmark.thumbnailUrl, /demo123/);
  assert.equal(bookmarkResponse.bookmark.thumbsUpCount, 12500);
  assert.equal(bookmarkResponse.bookmark.popularityCount, 12500);
  assert.match(bookmarkResponse.bookmark.summary, /orchestrating agent teams/);
  assert.ok(bookmarkResponse.bookmark.contentRef);

  const projectResponse = await sendMessage("UPSERT_PROJECT", {
    name: "Video export",
    description: "Video metadata export case."
  });

  await sendMessage("ASSIGN_BOOKMARKS_TO_PROJECT", {
    projectId: projectResponse.project.id,
    bookmarkIds: [bookmarkResponse.bookmark.id]
  });

  const exportResponse = await sendMessage("EXPORT_PROJECT", {
    projectId: projectResponse.project.id
  });

  assert.equal(exportResponse.ok, true);
  assert.match(exportResponse.html, /Agent Orchestration Deep Dive/);
  assert.match(exportResponse.html, /Description:/);
  assert.match(exportResponse.html, /hqdefault|maxresdefault/);
  assert.match(exportResponse.html, /Runtime:<\/strong> 43 min/);
  assert.match(exportResponse.html, /longer description text that should be preserved for export/);
});

await run("X posts and X articles preserve popularity metrics from saved metadata", async () => {
  const postResponse = await sendMessage("SAVE_BOOKMARK", {
    url: "https://x.com/deepak/status/456",
    notes: "Check engagement before adding to project.",
    metadata: {
      title: "Deepak on X",
      summary: "A post about ranking research links by popularity.",
      likesCount: "128",
      sharesCount: "23",
      capturedContent: "Ranking research links by popularity gives you a quick signal for what is resonating."
    }
  });

  assert.equal(postResponse.ok, true);
  assert.equal(postResponse.bookmark.likesCount, 128);
  assert.equal(postResponse.bookmark.sharesCount, 23);
  assert.equal(postResponse.bookmark.popularityCount, 151);

  const articleResponse = await sendMessage("SAVE_BOOKMARK", {
    url: "https://x.com/i/articles/123",
    notes: "Longform post with strong engagement.",
    metadata: {
      title: "Distillation notes on X",
      summary: "A longform X article about model distillation.",
      contentType: "article",
      likesCount: "4.2K",
      sharesCount: "320",
      capturedContent: "Distillation works best when the student target is specific."
    }
  });

  assert.equal(articleResponse.ok, true);
  assert.equal(articleResponse.bookmark.likesCount, 4200);
  assert.equal(articleResponse.bookmark.sharesCount, 320);
  assert.equal(articleResponse.bookmark.popularityCount, 4520);
});

await run("sortBookmarks supports popularity sorts with unknown metrics last", async () => {
  const sample = [
    {
      id: "a",
      title: "Alpha",
      createdAt: "2026-03-14T10:00:00.000Z",
      likesCount: 12,
      sharesCount: 5,
      thumbsUpCount: null,
      popularityCount: 17
    },
    {
      id: "b",
      title: "Beta",
      createdAt: "2026-03-14T11:00:00.000Z",
      likesCount: null,
      sharesCount: null,
      thumbsUpCount: 900,
      popularityCount: 900
    },
    {
      id: "c",
      title: "Gamma",
      createdAt: "2026-03-14T12:00:00.000Z",
      likesCount: null,
      sharesCount: null,
      thumbsUpCount: null,
      popularityCount: null
    }
  ];

  assert.deepEqual(sortBookmarks(sample, "popularity-desc").map((item) => item.id), ["b", "a", "c"]);
  assert.deepEqual(sortBookmarks(sample, "likes-desc").map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(sortBookmarks(sample, "shares-desc").map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(sortBookmarks(sample, "thumbs-up-desc").map((item) => item.id), ["b", "a", "c"]);
});

await run("raw backup export and import merge data safely", async () => {
  const exportResponse = await sendMessage("EXPORT_DATA");
  assert.equal(exportResponse.ok, true);
  const snapshot = JSON.parse(exportResponse.data);
  assert.ok(Array.isArray(snapshot.bookmarks));
  assert.ok(Array.isArray(snapshot.projects));

  const importResponse = await sendMessage("IMPORT_DATA", {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    bookmarks: [
      {
        id: "import-bookmark-1",
        url: "https://example.com/imported",
        title: "Imported article",
        summary: "Imported summary",
        tags: ["article", "blog"],
        contentType: "article",
        likesCount: "55",
        sharesCount: "8"
      }
    ],
    projects: [
      {
        id: "import-project-1",
        name: "Imported project",
        description: "Imported backup project",
        bookmarkIds: ["import-bookmark-1"]
      }
    ]
  });

  assert.equal(importResponse.ok, true);

  const stored = await chrome.storage.local.get([STORAGE_KEY, PROJECTS_KEY]);
  const importedBookmark = stored[STORAGE_KEY].find((item) => item.title === "Imported article");
  assert.ok(importedBookmark);
  assert.equal(importedBookmark.likesCount, 55);
  assert.equal(importedBookmark.sharesCount, 8);
  assert.equal(importedBookmark.popularityCount, 63);
  assert.ok(stored[PROJECTS_KEY].some((item) => item.name === "Imported project"));
});

process.exit(process.exitCode || 0);
