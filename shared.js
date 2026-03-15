export const STORAGE_KEY = "shelfmarkBookmarks";
export const PROJECTS_KEY = "shelfmarkProjects";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "si"
]);

export function normalizeUrl(inputUrl) {
  try {
    const url = new URL(inputUrl);
    url.hash = "";

    for (const [key] of url.searchParams.entries()) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return inputUrl.trim();
  }
}

export function slugFromHostname(hostname = "") {
  return hostname.replace(/^www\./, "").split(".")[0] || "site";
}

export function uniqueTags(tags = []) {
  return [...new Set(tags.filter(Boolean).map((tag) => tag.toLowerCase()))].sort();
}

export function shorten(text, max = 220) {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }

  if (cleaned.length <= max) {
    return cleaned;
  }

  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

export function normalizeCapturedContent(text = "", max = 30000) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max).trimEnd()}…`;
}

export function stripHtml(input = "") {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(main|article|section|header|footer|nav|aside|div|span|strong|em|b|i|u|p|h\d|li|ul|ol|br|figure|figcaption|blockquote)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(input = "") {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function parseIsoDuration(input = "") {
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

export function parseMaybeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function extractHostname(inputUrl) {
  try {
    return new URL(inputUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function extractYouTubeVideoId(inputUrl = "") {
  try {
    const url = new URL(inputUrl);
    const hostname = url.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return url.pathname.replace(/^\/+/, "").split("/")[0] || "";
    }

    if (hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v") || "";
      }

      const embedMatch = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (embedMatch?.[1]) {
        return embedMatch[1];
      }
    }
  } catch {
    return "";
  }

  return "";
}

export function buildYouTubeThumbnailUrl(inputUrl = "") {
  const videoId = extractYouTubeVideoId(inputUrl);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

export function classifyUrl(inputUrl) {
  const normalizedUrl = normalizeUrl(inputUrl);
  const hostname = extractHostname(normalizedUrl);
  const lowerUrl = normalizedUrl.toLowerCase();
  const tags = [];
  let contentType = "page";

  const isYouTube = /(^|\.)youtube\.com$/.test(hostname) || hostname === "youtu.be";
  const isX = hostname === "x.com" || hostname === "twitter.com" || hostname.endsWith(".x.com");
  const isPdf = lowerUrl.endsWith(".pdf") || lowerUrl.includes(".pdf?");
  const isPaperHost = /(arxiv\.org|openreview\.net|semanticscholar\.org|aclanthology\.org|papers\.nips\.cc|proceedings\.mlr\.press|doi\.org|researchgate\.net)/.test(hostname);

  if (isYouTube) {
    contentType = "video";
    tags.push("youtube", "video");
  }

  if (isX) {
    tags.push("x");
  }

  if (isPdf) {
    contentType = "pdf";
    tags.push("pdf");
  }

  if (isPaperHost || (isPdf && /paper|proceeding|preprint|arxiv|doi/i.test(lowerUrl))) {
    tags.push("paper");
  }

  if (hostname) {
    tags.push(slugFromHostname(hostname));
  }

  if (isX && /\/i\/articles\//.test(lowerUrl)) {
    contentType = "article";
    tags.push("article");
  }

  return {
    normalizedUrl,
    hostname,
    contentType,
    tags: uniqueTags(tags)
  };
}

export function inferTagsAndMetrics(metadata) {
  const base = classifyUrl(metadata.url);
  const tags = [...base.tags];
  let contentType = metadata.contentType || base.contentType;
  let runtimeMinutes = parseMaybeNumber(metadata.runtimeMinutes);
  let pageCount = parseMaybeNumber(metadata.pageCount);

  const title = String(metadata.title || "");
  const description = String(metadata.summary || "");
  const combined = `${title} ${description}`.toLowerCase();
  const ogType = String(metadata.ogType || "").toLowerCase();

  if (metadata.isPdf || metadata.mimeType === "application/pdf") {
    contentType = "pdf";
    tags.push("pdf");
  }

  if (ogType === "article" || /(^|\s)(blog|essay|newsletter|article)(\s|$)/i.test(combined)) {
    if (contentType === "page") {
      contentType = "article";
    }
    tags.push("article");
  }

  if (contentType === "article" && !tags.includes("x") && !tags.includes("paper")) {
    tags.push("blog");
  }

  if (/paper|preprint|arxiv|publication|journal|conference/i.test(combined)) {
    tags.push("paper");
  }

  if (/video|watch now|youtube/i.test(combined) || base.tags.includes("video")) {
    contentType = "video";
    tags.push("video");
  }

  if (base.tags.includes("youtube")) {
    contentType = "video";
    tags.push("youtube", "video");
  }

  if (base.tags.includes("x")) {
    tags.push("x");
    if (contentType === "article" || /\/i\/articles\//.test(base.normalizedUrl.toLowerCase())) {
      tags.push("article");
    }
  }

  if (!runtimeMinutes && metadata.wordCount) {
    runtimeMinutes = Math.max(1, Math.ceil(Number(metadata.wordCount) / 220));
  }

  if (!runtimeMinutes && pageCount) {
    runtimeMinutes = Math.max(1, Math.ceil(pageCount * 2));
  }

  if (!pageCount) {
    const pagesFromText = `${title} ${description}`.match(/(\d+)\s+pages?\b/i);
    if (pagesFromText) {
      pageCount = Number(pagesFromText[1]);
    }
  }

  return {
    ...base,
    contentType,
    runtimeMinutes,
    pageCount,
    tags: uniqueTags(tags)
  };
}

export function buildBookmarkRecord({ url, notes = "", metadata = {}, existing }) {
  const enriched = inferTagsAndMetrics({ ...metadata, url });
  const now = new Date().toISOString();
  const normalizedUrl = enriched.normalizedUrl || normalizeUrl(url);

  const title = shorten(
    metadata.title ||
      metadata.pageTitle ||
      metadata.siteName ||
      decodeURIComponent(normalizedUrl.split("/").pop() || normalizedUrl),
    120
  );

  const summary = shorten(
    metadata.summary ||
      metadata.description ||
      metadata.excerpt ||
      `${title} saved from ${enriched.hostname || "the web"}.`,
    260
  );

  return {
    id: existing?.id || crypto.randomUUID(),
    url,
    normalizedUrl,
    title,
    summary,
    notes: (notes || existing?.notes || "").trim(),
    tags: enriched.tags,
    contentType: enriched.contentType,
    runtimeMinutes: enriched.runtimeMinutes ?? null,
    pageCount: enriched.pageCount ?? null,
    wordCount: parseMaybeNumber(metadata.wordCount) ?? existing?.wordCount ?? null,
    capturedContent: normalizeCapturedContent(metadata.capturedContent || existing?.capturedContent || ""),
    thumbnailUrl: metadata.thumbnailUrl || existing?.thumbnailUrl || (enriched.tags.includes("youtube") ? buildYouTubeThumbnailUrl(url) : ""),
    siteName: metadata.siteName || existing?.siteName || slugFromHostname(enriched.hostname),
    hostname: enriched.hostname,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function getRuntimeBucket(minutes) {
  if (!minutes) {
    return "unknown";
  }
  if (minutes <= 5) {
    return "short";
  }
  if (minutes <= 20) {
    return "medium";
  }
  if (minutes <= 60) {
    return "long";
  }
  return "epic";
}

export function getPageBucket(pageCount) {
  if (!pageCount) {
    return "unknown";
  }
  if (pageCount <= 10) {
    return "short";
  }
  if (pageCount <= 30) {
    return "medium";
  }
  return "long";
}

export function matchesFilters(bookmark, filters) {
  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const haystack = `${bookmark.title} ${bookmark.summary} ${bookmark.notes} ${bookmark.tags.join(" ")}`.toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filters.contentType && filters.contentType !== "all" && bookmark.contentType !== filters.contentType) {
    return false;
  }

  if (filters.runtime && filters.runtime !== "all" && getRuntimeBucket(bookmark.runtimeMinutes) !== filters.runtime) {
    return false;
  }

  if (filters.pages && filters.pages !== "all" && getPageBucket(bookmark.pageCount) !== filters.pages) {
    return false;
  }

  const selectedTags = filters.tags || [];
  if (selectedTags.length && !selectedTags.every((tag) => bookmark.tags.includes(tag))) {
    return false;
  }

  return true;
}

export function sortBookmarks(bookmarks, sortKey) {
  const items = [...bookmarks];

  const compareText = (left, right) => left.localeCompare(right, undefined, { sensitivity: "base" });
  const compareNumber = (left, right) => (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);

  items.sort((left, right) => {
    switch (sortKey) {
      case "oldest":
        return new Date(left.createdAt) - new Date(right.createdAt);
      case "title":
        return compareText(left.title, right.title);
      case "runtime-asc":
        return compareNumber(left.runtimeMinutes, right.runtimeMinutes);
      case "runtime-desc":
        return compareNumber(right.runtimeMinutes, left.runtimeMinutes);
      case "pages-asc":
        return compareNumber(left.pageCount, right.pageCount);
      case "pages-desc":
        return compareNumber(right.pageCount, left.pageCount);
      default:
        return new Date(right.createdAt) - new Date(left.createdAt);
    }
  });

  return items;
}

export function formatRuntime(minutes) {
  if (!minutes) {
    return "Runtime unknown";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatPages(pageCount) {
  if (!pageCount) {
    return "Pages unknown";
  }
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

export function createProjectRecord({ id, name, description = "", learnings = "", bookmarkIds = [], images = [], createdAt, updatedAt }) {
  const now = new Date().toISOString();
  return {
    id: id || crypto.randomUUID(),
    name: shorten(name || "Untitled project", 80),
    description: shorten(description, 240),
    learnings: (learnings || "").trim(),
    bookmarkIds: [...new Set(bookmarkIds.filter(Boolean))],
    images: images.filter(Boolean),
    createdAt: createdAt || now,
    updatedAt: updatedAt || now
  };
}

export function slugifyFilePart(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "export";
}

export function htmlToPlainText(html = "") {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/?(article|section|main|header|footer|nav|aside|div|p|h1|h2|h3|h4|h5|h6|ul|ol|li|blockquote|pre|table|tr|td|th|figure|figcaption)[^>]*>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

export function extractReadableContentFromHtml(html = "") {
  const candidates = [];
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<body\b[^>]*>([\s\S]*?)<\/body>/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const text = htmlToPlainText(match[1]);
      if (text) {
        candidates.push(text);
      }
    }
  }

  if (!candidates.length) {
    candidates.push(htmlToPlainText(html));
  }

  const longest = candidates.sort((left, right) => right.length - left.length)[0] || "";
  return longest
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 40)
    .slice(0, 80)
    .join("\n\n");
}

export function isBlockedSocialExportHtml(html = "", url = "") {
  const lowerHtml = String(html || "").toLowerCase();
  const lowerUrl = String(url || "").toLowerCase();
  const isX = /(^https?:\/\/)?(www\.)?(x\.com|twitter\.com)\b/.test(lowerUrl);
  if (!isX) {
    return false;
  }

  return (
    lowerHtml.includes("we’ve detected that javascript is disabled") ||
    lowerHtml.includes("we've detected that javascript is disabled") ||
    lowerHtml.includes("supported browser to continue using x.com") ||
    lowerHtml.includes("privacy related extensions may cause issues on x.com") ||
    lowerHtml.includes("something went wrong, but don’t fret") ||
    lowerHtml.includes("something went wrong, but don't fret")
  );
}

export function extractPdfText(binaryText = "") {
  const matches = binaryText.match(/\((?:\\.|[^\\()]){12,}\)/g) || [];
  const paragraphs = matches
    .map((segment) =>
      segment
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, " ")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/\\\d{3}/g, " ")
    )
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter((segment) => /[a-z]{3,}/i.test(segment))
    .slice(0, 200);

  return paragraphs.join("\n\n");
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function findMeta(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return stripHtml(match[1]);
    }
  }
  return "";
}

function findFirstParagraph(html) {
  const match = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return match ? stripHtml(match[1]) : "";
}

function findTitle(html) {
  return (
    findMeta(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i
    ]) ||
    stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  );
}

function findDescription(html) {
  return (
    findMeta(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i
    ]) || findFirstParagraph(html)
  );
}

function findThumbnailUrl(html) {
  return findMeta(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+itemprop=["']thumbnailUrl["'][^>]+href=["']([^"']+)["']/i
  ]);
}

export function extractHtmlMetadataFromText(html, url, mimeType = "text/html") {
  const cleanHtml = html || "";
  const text = stripHtml(cleanHtml);
  const title = findTitle(cleanHtml);
  const summary = findDescription(cleanHtml);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : null;
  const siteName = findMeta(cleanHtml, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
  ]);
  const ogType = findMeta(cleanHtml, [
    /<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i
  ]);
  const thumbnailUrl = findThumbnailUrl(cleanHtml) || buildYouTubeThumbnailUrl(url);
  const pageCount = parseMaybeNumber(
    findMeta(cleanHtml, [
      /<meta[^>]+name=["']citation_num_pages["'][^>]+content=["']([^"']+)["']/i
    ])
  );

  const runtimeCandidates = [
    findMeta(cleanHtml, [/itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i]),
    cleanHtml.match(/"lengthSeconds":"?(\d+)"?/i)?.[1],
    findMeta(cleanHtml, [/property=["']video:duration["'][^>]+content=["']([^"']+)["']/i])
  ].filter(Boolean);

  let runtimeMinutes = null;
  for (const candidate of runtimeCandidates) {
    if (/^P/i.test(candidate)) {
      runtimeMinutes = parseIsoDuration(candidate);
    } else {
      const seconds = parseMaybeNumber(candidate);
      if (seconds) {
        runtimeMinutes = Math.max(1, Math.ceil(seconds / 60));
      }
    }
    if (runtimeMinutes) {
      break;
    }
  }

  return {
    url,
    title,
    summary,
    siteName,
    ogType,
    wordCount,
    pageCount,
    runtimeMinutes,
    thumbnailUrl,
    mimeType,
    isPdf: mimeType === "application/pdf"
  };
}

export function estimatePdfPageCount(binaryText) {
  const matches = binaryText.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}
