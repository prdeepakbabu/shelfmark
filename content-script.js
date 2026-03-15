function getMetaContent(selector) {
  return document.querySelector(selector)?.getAttribute("content")?.trim() || "";
}

function shortenText(text, max = 240) {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function textFromSelector(selector) {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function parseIsoDuration(input = "") {
  const match = input.match(/P(?:\d+Y)?(?:\d+M)?(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) {
    return null;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const totalMinutes = hours * 60 + minutes + seconds / 60;
  return totalMinutes > 0 ? Math.ceil(totalMinutes) : null;
}

function parseCompactCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const cleaned = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/,/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[String(match[2] || "").toLowerCase()] || 1;
  return Math.round(amount * multiplier);
}

function extractMetricCountFromText(text, labelPatterns = []) {
  const normalized = String(text || "").replace(/\u00a0/g, " ").trim();
  if (!normalized) {
    return null;
  }

  for (const labelPattern of labelPatterns) {
    const forward = normalized.match(new RegExp(`(\\d+(?:[,.]\\d+)?\\s*[kmb]?)\\s*${labelPattern}`, "i"));
    if (forward?.[1]) {
      return parseCompactCount(forward[1]);
    }

    const reverse = normalized.match(new RegExp(`${labelPattern}[^\\d]{0,24}(\\d+(?:[,.]\\d+)?\\s*[kmb]?)`, "i"));
    if (reverse?.[1]) {
      return parseCompactCount(reverse[1]);
    }
  }

  return null;
}

function calculatePopularityCount({ likesCount = null, sharesCount = null, thumbsUpCount = null } = {}) {
  const primaryReactionCount = Math.max(likesCount || 0, thumbsUpCount || 0);
  const shareCount = sharesCount || 0;
  const total = primaryReactionCount + shareCount;
  return total > 0 ? total : null;
}

function collectNodeTexts(node) {
  if (!node) {
    return [];
  }

  return [
    node.getAttribute?.("aria-label"),
    node.getAttribute?.("title"),
    node.innerText,
    node.textContent,
    node.parentElement?.getAttribute?.("aria-label"),
    node.parentElement?.innerText
  ].filter(Boolean);
}

function extractCountFromNodes(nodes, labelPatterns, allowBareNumber = false) {
  for (const node of nodes) {
    for (const text of collectNodeTexts(node)) {
      const labeledCount = extractMetricCountFromText(text, labelPatterns);
      if (labeledCount !== null) {
        return labeledCount;
      }

      if (allowBareNumber) {
        const bareCount = parseCompactCount(text);
        if (bareCount !== null) {
          return bareCount;
        }
      }
    }
  }

  return null;
}

function getPopularityMetrics() {
  const hostname = location.hostname.replace(/^www\./, "");
  const isYouTube = hostname === "youtu.be" || hostname.endsWith("youtube.com");
  const isX = hostname === "x.com" || hostname === "twitter.com";

  if (isYouTube) {
    const thumbsUpCount = extractCountFromNodes(
      [
        ...document.querySelectorAll('segmented-like-dislike-button-view-model button'),
        ...document.querySelectorAll('#top-level-buttons-computed button'),
        ...document.querySelectorAll('button[aria-label*="like" i]')
      ],
      ["likes?", "thumbs?\\s*ups?", "other people"],
      true
    );

    return {
      likesCount: null,
      sharesCount: null,
      thumbsUpCount,
      popularityCount: calculatePopularityCount({ thumbsUpCount })
    };
  }

  if (isX) {
    const scope = document.querySelector("article") || document.body || document.documentElement;
    const likesCount = extractCountFromNodes(
      [
        ...scope.querySelectorAll('[data-testid="like"], [data-testid="unlike"]'),
        ...scope.querySelectorAll('button[aria-label*="Like" i]')
      ],
      ["likes?"],
      true
    );
    const sharesCount = extractCountFromNodes(
      [
        ...scope.querySelectorAll('[data-testid="retweet"], [data-testid="unretweet"], [data-testid="share"]'),
        ...scope.querySelectorAll('button[aria-label*="Repost" i], button[aria-label*="Share" i]')
      ],
      ["reposts?", "shares?"],
      true
    );

    return {
      likesCount,
      sharesCount,
      thumbsUpCount: null,
      popularityCount: calculatePopularityCount({ likesCount, sharesCount })
    };
  }

  return {
    likesCount: null,
    sharesCount: null,
    thumbsUpCount: null,
    popularityCount: null
  };
}

function getWordCount() {
  const mainText =
    textFromSelector("article") ||
    textFromSelector("main") ||
    document.body?.innerText?.replace(/\s+/g, " ").trim() ||
    "";

  return mainText ? mainText.split(/\s+/).filter(Boolean).length : null;
}

function getSummary(fallbackText = "") {
  const metaSummary =
    getMetaContent('meta[name="description"]') ||
    getMetaContent('meta[property="og:description"]') ||
    getMetaContent('meta[name="twitter:description"]');

  const hostname = location.hostname.replace(/^www\./, "");
  const isX = hostname === "x.com" || hostname === "twitter.com";
  const normalizedFallback = fallbackText.replace(/\s+/g, " ").trim();

  if (isX && normalizedFallback) {
    return normalizedFallback;
  }

  return (
    metaSummary ||
    normalizedFallback ||
    shortenText(textFromSelector("article p") || textFromSelector("main p") || textFromSelector("p"))
  );
}

function extractReadablePageContent() {
  const hostname = location.hostname.replace(/^www\./, "");
  const isX = hostname === "x.com" || hostname === "twitter.com";

  if (isX) {
    const articleLike = document.querySelector("article");
    const mainLike = document.querySelector("main");
    const block = articleLike || mainLike || document.body;
    return block?.innerText?.replace(/\n{3,}/g, "\n\n").trim() || "";
  }

  const candidates = [
    ...document.querySelectorAll("article p, article li"),
    ...document.querySelectorAll("main p, main li"),
    ...document.querySelectorAll("p, li")
  ];

  const paragraphs = [];
  const seen = new Set();

  for (const node of candidates) {
    const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text.length < 40 || seen.has(text)) {
      continue;
    }
    seen.add(text);
    paragraphs.push(text);
    if (paragraphs.length >= 80) {
      break;
    }
  }

  return paragraphs.join("\n\n");
}

function getRuntimeMinutes() {
  const duration =
    getMetaContent('meta[itemprop="duration"]') ||
    getMetaContent('meta[property="video:duration"]');

  if (duration) {
    if (/^P/i.test(duration)) {
      return parseIsoDuration(duration);
    }

    const seconds = Number(duration);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(1, Math.ceil(seconds / 60));
    }
  }

  const ytPlayer = document.querySelector("ytd-watch-flexy");
  if (ytPlayer) {
    const lengthSeconds = Number(document.querySelector("meta[itemprop='duration']")?.content || 0);
    if (lengthSeconds) {
      return Math.max(1, Math.ceil(lengthSeconds / 60));
    }
  }

  return null;
}

function extractCurrentPageMetadata() {
  const capturedContent = extractReadablePageContent();
  const popularity = getPopularityMetrics();
  return {
    url: location.href,
    title:
      getMetaContent('meta[property="og:title"]') ||
      getMetaContent('meta[name="twitter:title"]') ||
      document.title,
    summary: getSummary(capturedContent.split(/\n{2,}/).find(Boolean) || ""),
    fullDescription: capturedContent || getSummary(),
    siteName: getMetaContent('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, ""),
    ogType: getMetaContent('meta[property="og:type"]'),
    thumbnailUrl:
      getMetaContent('meta[property="og:image"]') ||
      getMetaContent('meta[name="twitter:image"]'),
    runtimeMinutes: getRuntimeMinutes(),
    wordCount: getWordCount(),
    likesCount: popularity.likesCount,
    sharesCount: popularity.sharesCount,
    thumbsUpCount: popularity.thumbsUpCount,
    popularityCount: popularity.popularityCount,
    capturedContent,
    pageTitle: document.title,
    contentType: document.contentType === "application/pdf" ? "pdf" : undefined,
    isPdf: document.contentType === "application/pdf" || /\.pdf($|\?)/i.test(location.href)
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "EXTRACT_PAGE_METADATA") {
    sendResponse({ ok: true, metadata: extractCurrentPageMetadata() });
  }
});
