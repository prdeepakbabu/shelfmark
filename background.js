import {
  PROJECTS_KEY,
  STORAGE_KEY,
  buildYouTubeThumbnailUrl,
  buildBookmarkRecord,
  classifyUrl,
  createProjectRecord,
  escapeHtml,
  extractYouTubeVideoId,
  estimatePdfPageCount,
  extractPdfText,
  extractReadableContentFromHtml,
  extractHtmlMetadataFromText,
  isBlockedSocialExportHtml,
  normalizeUrl,
  slugifyFilePart,
  shorten
} from "./shared.js";
import {
  deleteContentRecords,
  getContentRecord,
  listContentRecords,
  putContentRecord
} from "./content-store.js";

const BACKUP_SCHEMA_VERSION = 1;

async function getBookmarks() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || [];
}

async function setBookmarks(bookmarks) {
  await chrome.storage.local.set({ [STORAGE_KEY]: bookmarks });
}

async function getProjects() {
  const stored = await chrome.storage.local.get(PROJECTS_KEY);
  return stored[PROJECTS_KEY] || [];
}

async function setProjects(projects) {
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
}

function buildContentRecord({ id, url, metadata = {}, existingRecord = null, bookmark = null }) {
  const fullTitle = String(
    metadata.fullTitle ||
      metadata.title ||
      metadata.pageTitle ||
      existingRecord?.fullTitle ||
      bookmark?.title ||
      "Untitled source"
  ).replace(/\s+/g, " ").trim();

  const fullDescription = String(
    metadata.fullDescription ||
      metadata.summary ||
      metadata.description ||
      metadata.excerpt ||
      existingRecord?.fullDescription ||
      ""
  ).replace(/\s+/g, " ").trim();

  const capturedText = String(
    metadata.capturedContent ||
      existingRecord?.capturedText ||
      ""
  ).replace(/\r/g, "").trim();

  if (!fullTitle && !fullDescription && !capturedText) {
    return null;
  }

  return {
    id: id || existingRecord?.id || crypto.randomUUID(),
    url,
    fullTitle: fullTitle || existingRecord?.fullTitle || bookmark?.title || "Untitled source",
    fullDescription,
    capturedText,
    createdAt: existingRecord?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

let initializationPromise = null;

async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const bookmarks = await getBookmarks();
      if (!Array.isArray(bookmarks)) {
        await setBookmarks([]);
      }

      const projects = await getProjects();
      if (!Array.isArray(projects)) {
        await setProjects([]);
      }

      await migrateInlineBookmarkContent();
    })();
  }

  return initializationPromise;
}

async function upsertBookmark({ url, notes, metadata }) {
  await ensureInitialized();
  const normalizedUrl = normalizeUrl(url);
  const bookmarks = await getBookmarks();
  const existing = bookmarks.find((bookmark) => bookmark.normalizedUrl === normalizedUrl);
  const existingContent = existing?.contentRef ? await getContentRecord(existing.contentRef) : null;
  const remoteMetadata = await fetchUrlMetadata(url, existing);
  const mergedMetadata = { ...remoteMetadata, ...metadata, url };
  const contentRecord = buildContentRecord({
    id: existing?.contentRef,
    url,
    metadata: mergedMetadata,
    existingRecord: existingContent,
    bookmark: existing
  });
  if (contentRecord) {
    await putContentRecord(contentRecord);
  }
  const bookmark = buildBookmarkRecord({
    url,
    notes,
    metadata: {
      ...mergedMetadata,
      contentRef: contentRecord?.id || existing?.contentRef || null
    },
    existing
  });

  const nextBookmarks = existing
    ? bookmarks.map((item) => (item.id === existing.id ? bookmark : item))
    : [bookmark, ...bookmarks];

  await setBookmarks(nextBookmarks);

  return {
    bookmark,
    status: existing ? "updated" : "created"
  };
}

async function fetchYouTubeMetadata(url, existing) {
  const videoId = extractYouTubeVideoId(url);
  const fallbackThumbnail = buildYouTubeThumbnailUrl(url);
  const result = {
    url,
    title: existing?.title || "YouTube video",
    summary: existing?.summary || "YouTube video saved for later review.",
    thumbnailUrl: existing?.thumbnailUrl || fallbackThumbnail,
    contentType: "video",
    tags: ["youtube", "video"]
  };

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, { redirect: "follow" });
    if (response.ok) {
      const data = await response.json();
      result.title = data.title || result.title;
      result.thumbnailUrl = data.thumbnail_url || result.thumbnailUrl;
      result.siteName = data.author_name || result.siteName || "YouTube";
    }
  } catch {
    // Ignore oEmbed failures and continue with generic extraction.
  }

  try {
    const response = await fetch(url, { redirect: "follow" });
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    const html = await response.text();
    const pageMetadata = extractHtmlMetadataFromText(html, response.url || url, mimeType || "text/html");
    const shortDescriptionMatch = html.match(/"shortDescription":"((?:\\.|[^"])*)"/i);
    let fullDescription = pageMetadata.summary || result.summary;
    if (shortDescriptionMatch?.[1]) {
      try {
        fullDescription = JSON.parse(`"${shortDescriptionMatch[1]}"`);
      } catch {
        fullDescription = pageMetadata.summary || result.summary;
      }
    }
    return {
      ...pageMetadata,
      ...result,
      title: pageMetadata.title && pageMetadata.title.toLowerCase() !== "youtube" ? pageMetadata.title : result.title,
      summary:
        pageMetadata.summary &&
        !/^enjoy the videos and music you love/i.test(pageMetadata.summary)
          ? pageMetadata.summary
          : result.summary,
      fullDescription,
      thumbnailUrl: pageMetadata.thumbnailUrl || result.thumbnailUrl || fallbackThumbnail,
      contentType: "video",
      isYouTube: true,
      videoId
    };
  } catch {
    return {
      ...result,
      isYouTube: true,
      videoId
    };
  }
}

async function fetchUrlMetadata(url, existing) {
  await ensureInitialized();
  const classification = classifyUrl(url);
  if (!/^https?:/i.test(url)) {
    return {
      url,
      title: existing?.title || url,
      summary: existing?.summary || "Chrome does not allow metadata extraction for this URL.",
      contentType: classification.contentType,
      tags: classification.tags
    };
  }

  if (classification.tags.includes("youtube")) {
    return fetchYouTubeMetadata(url, existing);
  }

  try {
    const response = await fetch(url, { redirect: "follow" });
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    const finalUrl = response.url || url;

    if (mimeType === "application/pdf" || classifyUrl(finalUrl).contentType === "pdf") {
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder("iso-8859-1");
      const binaryText = decoder.decode(buffer);
      const pageCount = estimatePdfPageCount(binaryText);
      const fileName = decodeURIComponent(finalUrl.split("/").pop() || "PDF");
      return {
        url: finalUrl,
        title: shorten(fileName.replace(/\.pdf$/i, "")) || existing?.title || "PDF document",
        summary: existing?.summary || "PDF saved for later review.",
        pageCount,
        mimeType: "application/pdf",
        isPdf: true
      };
    }

    const html = await response.text();
    return extractHtmlMetadataFromText(html, finalUrl, mimeType || "text/html");
  } catch (error) {
    return {
      url,
      title: existing?.title || decodeURIComponent(url.split("/").pop() || url),
      summary: existing?.summary || "Metadata could not be fetched for this page.",
      fetchError: String(error)
    };
  }
}

async function scrapeBookmarkContent(bookmark) {
  await ensureInitialized();
  const classification = classifyUrl(bookmark.url);
  const contentRecord = bookmark.contentRef ? await getContentRecord(bookmark.contentRef) : null;
  const base = {
    id: bookmark.id,
    title: contentRecord?.fullTitle || bookmark.title,
    referenceUrl: bookmark.url,
    summary: contentRecord?.fullDescription || bookmark.summary,
    notes: bookmark.notes || "",
    contentType: bookmark.contentType,
    runtimeMinutes: bookmark.runtimeMinutes ?? null,
    thumbnailUrl: bookmark.thumbnailUrl || "",
    status: "ok",
    content: ""
  };

  const cachedContent = String(contentRecord?.capturedText || "").trim();

  if (classification.tags.includes("x") && cachedContent) {
    return {
      ...base,
      status: "cached",
      content: cachedContent
    };
  }

  if (classification.tags.includes("youtube")) {
    return {
      ...base,
      status: "metadata",
      content: cachedContent || ""
    };
  }

  if (!/^https?:/i.test(bookmark.url)) {
    return {
      ...base,
      status: "unsupported",
      content: "This URL cannot be scraped by the extension."
    };
  }

  try {
    const response = await fetch(bookmark.url, { redirect: "follow" });
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";

    if (mimeType === "application/pdf" || bookmark.contentType === "pdf") {
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder("iso-8859-1");
      const binaryText = decoder.decode(buffer);
      const content = extractPdfText(binaryText);
      return {
        ...base,
        referenceUrl: response.url || bookmark.url,
        status: content ? "ok" : "partial",
        content: content || "PDF text extraction was limited for this document."
      };
    }

    const html = await response.text();
    if (isBlockedSocialExportHtml(html, response.url || bookmark.url)) {
      return {
        ...base,
        referenceUrl: response.url || bookmark.url,
        status: cachedContent ? "cached" : "blocked",
        content: cachedContent || "X blocked automated export for this source. Re-save the page while you are viewing it in Chrome to capture readable text for export."
      };
    }

    const extracted = extractReadableContentFromHtml(html);
    return {
      ...base,
      referenceUrl: response.url || bookmark.url,
      status: extracted ? "ok" : cachedContent ? "cached" : "partial",
      content: extracted || cachedContent || "Readable content could not be extracted from this page."
    };
  } catch (error) {
    return {
      ...base,
      status: cachedContent ? "cached" : "error",
      content: cachedContent || `Scrape failed: ${String(error)}`
    };
  }
}

function toMaybeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function migrateInlineBookmarkContent() {
  const bookmarks = await getBookmarks();
  let changed = false;
  const nextBookmarks = [];

  for (const bookmark of bookmarks) {
    if (!bookmark) {
      continue;
    }

    const existingContent = bookmark.contentRef ? await getContentRecord(bookmark.contentRef) : null;
    const legacyContentRecord = buildContentRecord({
      id: bookmark.contentRef,
      url: bookmark.url,
      metadata: {
        fullTitle: bookmark.fullTitle || bookmark.title,
        fullDescription: bookmark.fullDescription || bookmark.summary,
        capturedContent: bookmark.capturedContent || ""
      },
      existingRecord: existingContent,
      bookmark
    });

    const normalizedBookmark = { ...bookmark };
    if (legacyContentRecord) {
      await putContentRecord(legacyContentRecord);
      normalizedBookmark.contentRef = legacyContentRecord.id;
    }

    if ("capturedContent" in normalizedBookmark || "fullTitle" in normalizedBookmark || "fullDescription" in normalizedBookmark) {
      delete normalizedBookmark.capturedContent;
      delete normalizedBookmark.fullTitle;
      delete normalizedBookmark.fullDescription;
      changed = true;
    }

    if (legacyContentRecord && normalizedBookmark.contentRef !== bookmark.contentRef) {
      changed = true;
    }

    nextBookmarks.push(normalizedBookmark);
  }

  if (changed) {
    await setBookmarks(nextBookmarks);
  }
}

function normalizeImportedBookmark(bookmark = {}) {
  const now = new Date().toISOString();
  return {
    id: bookmark.id || crypto.randomUUID(),
    url: bookmark.url || "",
    normalizedUrl: normalizeUrl(bookmark.normalizedUrl || bookmark.url || ""),
    title: shorten(bookmark.title || "Untitled bookmark", 120),
    summary: shorten(bookmark.summary || bookmark.description || "Saved bookmark.", 260),
    notes: String(bookmark.notes || "").trim(),
    tags: Array.isArray(bookmark.tags) ? [...new Set(bookmark.tags.filter(Boolean).map((tag) => String(tag).toLowerCase()))].sort() : [],
    contentType: bookmark.contentType || classifyUrl(bookmark.url || "").contentType,
    runtimeMinutes: toMaybeNumber(bookmark.runtimeMinutes),
    pageCount: toMaybeNumber(bookmark.pageCount),
    wordCount: toMaybeNumber(bookmark.wordCount),
    contentRef: bookmark.contentRef || null,
    thumbnailUrl: String(bookmark.thumbnailUrl || "").trim(),
    siteName: String(bookmark.siteName || "").trim(),
    hostname: String(bookmark.hostname || classifyUrl(bookmark.url || "").hostname || "").trim(),
    createdAt: bookmark.createdAt || now,
    updatedAt: bookmark.updatedAt || now
  };
}

function normalizeImportedProject(project = {}, bookmarkIdMap = new Map()) {
  const importedBookmarkIds = Array.isArray(project.bookmarkIds) ? project.bookmarkIds : [];
  const mappedBookmarkIds = importedBookmarkIds
    .map((id) => bookmarkIdMap.get(id) || id)
    .filter(Boolean);

  return createProjectRecord({
    id: project.id,
    name: project.name || "Untitled project",
    description: project.description || "",
    learnings: project.learnings || "",
    bookmarkIds: mappedBookmarkIds,
    images: Array.isArray(project.images) ? project.images.filter(Boolean) : [],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  });
}

async function exportDataSnapshot() {
  await ensureInitialized();
  const [bookmarks, projects, contentRecords] = await Promise.all([getBookmarks(), getProjects(), listContentRecords()]);
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarks,
    projects,
    contentRecords
  };
}

async function importDataSnapshot(snapshot) {
  await ensureInitialized();
  const importedBookmarks = Array.isArray(snapshot?.bookmarks) ? snapshot.bookmarks : null;
  const importedProjects = Array.isArray(snapshot?.projects) ? snapshot.projects : null;
  const importedContentRecords = Array.isArray(snapshot?.contentRecords) ? snapshot.contentRecords : [];

  if (!importedBookmarks || !importedProjects) {
    throw new Error("Backup file is invalid. Expected bookmarks and projects arrays.");
  }

  const [existingBookmarks, existingProjects] = await Promise.all([getBookmarks(), getProjects()]);
  const bookmarksByNormalizedUrl = new Map(existingBookmarks.map((bookmark) => [bookmark.normalizedUrl || normalizeUrl(bookmark.url), bookmark]));
  const bookmarkIdMap = new Map();
  const contentIdMap = new Map();

  for (const rawBookmark of importedBookmarks) {
    const normalized = normalizeImportedBookmark(rawBookmark);
    const existing = bookmarksByNormalizedUrl.get(normalized.normalizedUrl);
    if (existing) {
      const targetContentRef = existing.contentRef || normalized.contentRef || crypto.randomUUID();
      const merged = {
        ...existing,
        ...normalized,
        id: existing.id,
        contentRef: targetContentRef,
        createdAt: existing.createdAt || normalized.createdAt,
        updatedAt: new Date().toISOString()
      };
      bookmarksByNormalizedUrl.set(merged.normalizedUrl, merged);
      bookmarkIdMap.set(rawBookmark.id, existing.id);
      if (rawBookmark.contentRef) {
        contentIdMap.set(rawBookmark.contentRef, targetContentRef);
      }
    } else {
      const targetContentRef = normalized.contentRef || (rawBookmark.fullDescription || rawBookmark.capturedContent ? crypto.randomUUID() : null);
      normalized.contentRef = targetContentRef;
      bookmarksByNormalizedUrl.set(normalized.normalizedUrl, normalized);
      bookmarkIdMap.set(rawBookmark.id, normalized.id);
      if (rawBookmark.contentRef) {
        contentIdMap.set(rawBookmark.contentRef, targetContentRef);
      }
    }
  }

  const mergedBookmarks = [...bookmarksByNormalizedUrl.values()].sort(
    (left, right) => new Date(right.createdAt) - new Date(left.createdAt)
  );

  for (const rawBookmark of importedBookmarks) {
    if ((rawBookmark.fullTitle || rawBookmark.fullDescription || rawBookmark.capturedContent) && !rawBookmark.contentRef) {
      const mappedBookmarkId = bookmarkIdMap.get(rawBookmark.id);
      const targetBookmark = mergedBookmarks.find((bookmark) => bookmark.id === mappedBookmarkId);
      if (targetBookmark) {
        const newContentId = targetBookmark.contentRef || crypto.randomUUID();
        targetBookmark.contentRef = newContentId;
        contentIdMap.set(`legacy:${rawBookmark.id}`, newContentId);
      }
    }
  }

  const existingContentRecords = await listContentRecords();
  const contentById = new Map(existingContentRecords.map((record) => [record.id, record]));

  for (const rawRecord of importedContentRecords) {
    const targetId = contentIdMap.get(rawRecord.id) || rawRecord.id;
    const existing = contentById.get(targetId);
    const normalizedRecord = buildContentRecord({
      id: targetId,
      url: rawRecord.url || "",
      metadata: {
        fullTitle: rawRecord.fullTitle,
        fullDescription: rawRecord.fullDescription,
        capturedContent: rawRecord.capturedText
      },
      existingRecord: existing
    });
    if (normalizedRecord) {
      contentById.set(targetId, normalizedRecord);
    }
  }

  for (const rawBookmark of importedBookmarks) {
    if (rawBookmark.fullTitle || rawBookmark.fullDescription || rawBookmark.capturedContent) {
      const mappedBookmarkId = bookmarkIdMap.get(rawBookmark.id);
      const targetBookmark = mergedBookmarks.find((bookmark) => bookmark.id === mappedBookmarkId);
      if (!targetBookmark) {
        continue;
      }
      const targetId =
        targetBookmark.contentRef ||
        contentIdMap.get(rawBookmark.contentRef) ||
        contentIdMap.get(`legacy:${rawBookmark.id}`) ||
        crypto.randomUUID();
      targetBookmark.contentRef = targetId;
      const normalizedRecord = buildContentRecord({
        id: targetId,
        url: rawBookmark.url || targetBookmark.url,
        metadata: {
          fullTitle: rawBookmark.fullTitle || rawBookmark.title,
          fullDescription: rawBookmark.fullDescription || rawBookmark.summary || rawBookmark.description,
          capturedContent: rawBookmark.capturedContent || ""
        },
        existingRecord: contentById.get(targetId),
        bookmark: targetBookmark
      });
      if (normalizedRecord) {
        contentById.set(targetId, normalizedRecord);
      }
    }
  }

  const projectsById = new Map(existingProjects.map((project) => [project.id, project]));
  for (const rawProject of importedProjects) {
    const normalized = normalizeImportedProject(rawProject, bookmarkIdMap);
    if (projectsById.has(normalized.id)) {
      const existing = projectsById.get(normalized.id);
      projectsById.set(normalized.id, createProjectRecord({
        ...existing,
        ...normalized,
        bookmarkIds: [...new Set([...(existing.bookmarkIds || []), ...(normalized.bookmarkIds || [])])],
        images: [...(normalized.images || []), ...(existing.images || [])],
        createdAt: existing.createdAt || normalized.createdAt,
        updatedAt: new Date().toISOString()
      }));
    } else {
      projectsById.set(normalized.id, normalized);
    }
  }

  const mergedProjects = [...projectsById.values()].sort(
    (left, right) => new Date(right.createdAt) - new Date(left.createdAt)
  );

  await Promise.all([setBookmarks(mergedBookmarks), setProjects(mergedProjects)]);
  await Promise.all([...contentById.values()].map((record) => putContentRecord(record)));

  return {
    bookmarkCount: mergedBookmarks.length,
    projectCount: mergedProjects.length,
    contentCount: contentById.size
  };
}

function buildProjectExportHtml(project, bookmarks, sources) {
  const exportedAt = new Date().toLocaleString();
  const exportSlug = slugifyFilePart(project.name);
  const sourceSections = sources
    .map((source, index) => {
      const bookmark = bookmarks.find((item) => item.id === source.id);
      const bookmarkNote = bookmark?.notes ? `<p><strong>Saved note:</strong> ${escapeHtml(bookmark.notes)}</p>` : "";
      const mediaCard = source.thumbnailUrl
        ? `
          <div class="media-card">
            <img class="media-thumb" src="${escapeHtml(source.thumbnailUrl)}" alt="${escapeHtml(source.title || "Source thumbnail")}">
            <div class="media-copy">
              <p class="source-meta"><strong>Reference URL:</strong> <a href="${escapeHtml(source.referenceUrl)}">${escapeHtml(source.referenceUrl)}</a></p>
              <p class="source-meta"><strong>Type:</strong> ${escapeHtml(source.contentType || "page")} · <strong>Export status:</strong> ${escapeHtml(source.status)}${source.runtimeMinutes ? ` · <strong>Runtime:</strong> ${escapeHtml(source.runtimeMinutes)} min` : ""}</p>
              <p><strong>${source.contentType === "video" ? "Description" : "Summary"}:</strong> ${escapeHtml(source.summary || "No summary available.")}</p>
              ${bookmarkNote}
            </div>
          </div>
        `
        : `
          <p class="source-meta"><strong>Reference URL:</strong> <a href="${escapeHtml(source.referenceUrl)}">${escapeHtml(source.referenceUrl)}</a></p>
          <p class="source-meta"><strong>Type:</strong> ${escapeHtml(source.contentType || "page")} · <strong>Export status:</strong> ${escapeHtml(source.status)}${source.runtimeMinutes ? ` · <strong>Runtime:</strong> ${escapeHtml(source.runtimeMinutes)} min` : ""}</p>
          <p><strong>${source.contentType === "video" ? "Description" : "Summary"}:</strong> ${escapeHtml(source.summary || "No summary available.")}</p>
          ${bookmarkNote}
        `;
      const contentBlocks = escapeHtml(source.content || "")
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join("");
      const contentSection = contentBlocks
        ? contentBlocks
        : source.contentType === "video"
          ? ""
          : "<p>No readable content was extracted for this source.</p>";

      return `
        <section class="source-card">
          <p class="source-index">Source ${index + 1}</p>
          <h2>${escapeHtml(source.title || "Untitled source")}</h2>
          ${mediaCard}
          <div class="source-content">
            ${contentSection}
          </div>
        </section>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(project.name)} export</title>
    <style>
      body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: #f8f4ec; color: #1f2430; }
      main { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
      .cover, .source-card { background: #fffdfa; border: 1px solid rgba(31,36,48,.12); border-radius: 22px; padding: 28px; box-shadow: 0 18px 40px rgba(75,54,28,.08); }
      .cover { margin-bottom: 24px; }
      .eyebrow, .source-index { text-transform: uppercase; letter-spacing: .14em; color: #0f766e; font: 700 12px/1.4 Arial, sans-serif; margin: 0 0 10px; }
      h1, h2 { margin: 0 0 14px; line-height: 1.1; }
      p, li { font-size: 16px; line-height: 1.65; }
      .meta { color: #6f716f; }
      .section { margin-top: 24px; }
      .source-card + .source-card { margin-top: 18px; }
      .source-meta { font-family: Arial, sans-serif; font-size: 13px; color: #5a5d63; word-break: break-word; }
      .source-content p { margin: 0 0 14px; }
      .media-card { display: grid; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); gap: 18px; align-items: start; margin-bottom: 14px; }
      .media-thumb { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 16px; border: 1px solid rgba(31,36,48,.12); background: #ece7dd; }
      .media-copy { min-width: 0; }
      a { color: #0f766e; }
      .annotation-panel { position: sticky; top: 18px; z-index: 20; max-width: 960px; margin: 0 auto 18px; padding: 16px 18px; border-radius: 18px; background: rgba(255,253,250,.96); border: 1px solid rgba(31,36,48,.12); box-shadow: 0 18px 30px rgba(75,54,28,.10); backdrop-filter: blur(8px); }
      .annotation-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .annotation-help { margin: 0 0 12px; font: 13px/1.5 Arial, sans-serif; color: #5a5d63; }
      .annotation-panel button, .annotation-panel input { font: 13px/1.3 Arial, sans-serif; }
      .annotation-panel input { flex: 1 1 260px; min-width: 220px; padding: 10px 12px; border-radius: 999px; border: 1px solid rgba(31,36,48,.14); background: white; }
      .annotation-panel button { border: none; border-radius: 999px; padding: 10px 14px; cursor: pointer; font-weight: 700; }
      .annotation-panel button[data-color="yellow"] { background: #fef08a; color: #713f12; }
      .annotation-panel button[data-color="green"] { background: #bbf7d0; color: #166534; }
      .annotation-panel button[data-color="gray"] { background: #e5e7eb; color: #374151; }
      .annotation-panel .save-copy { background: #0f766e; color: white; }
      .annotation-panel .save-pdf { background: #1f2937; color: white; }
      .annotation-panel .selection-preview { font: 12px/1.5 Arial, sans-serif; color: #6f716f; margin-top: 10px; }
      .annotation { position: relative; border-radius: 4px; padding: 0 .08em; box-decoration-break: clone; -webkit-box-decoration-break: clone; cursor: pointer; }
      .annotation-yellow { background: rgba(254, 240, 138, .95); }
      .annotation-green { background: rgba(187, 247, 208, .95); }
      .annotation-gray { background: rgba(229, 231, 235, .95); }
      .annotation[data-comment]::after { content: " " attr(data-comment); position: absolute; left: 0; top: calc(100% + 8px); min-width: 220px; max-width: 360px; padding: 10px 12px; border-radius: 12px; background: #1f2430; color: white; font: 12px/1.5 Arial, sans-serif; white-space: pre-wrap; box-shadow: 0 14px 28px rgba(31,36,48,.2); opacity: 0; pointer-events: none; transform: translateY(-6px); transition: opacity .14s ease, transform .14s ease; z-index: 15; }
      .annotation.show-comment::after, .annotation:hover::after { opacity: 1; transform: translateY(0); }
      @media print {
        body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        main { max-width: none; padding: 0; }
        .annotation-panel { display: none; }
        .cover, .source-card { box-shadow: none; border-color: rgba(31,36,48,.18); break-inside: avoid; page-break-inside: avoid; }
        .source-card + .source-card { margin-top: 12px; }
        a { color: #1f2430; text-decoration: none; }
        .annotation[data-comment]::after { display: none; }
      }
      @media (max-width: 760px) {
        .media-card { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <section class="annotation-panel">
      <p class="annotation-help">Export format: a single self-contained HTML file with project notes at the top and source content below. Select text within one paragraph, choose yellow, green, or gray, optionally add a comment, then save an annotated copy or print it to PDF.</p>
      <div class="annotation-row">
        <button type="button" data-color="yellow">Yellow</button>
        <button type="button" data-color="green">Green</button>
        <button type="button" data-color="gray">Gray</button>
        <input id="annotationComment" type="text" placeholder="Optional comment for the highlighted text">
        <button type="button" class="save-copy">Save annotated copy</button>
        <button type="button" class="save-pdf">Print / Save as PDF</button>
      </div>
      <p class="selection-preview" id="selectionPreview">No text selected.</p>
    </section>
    <main>
      <section class="cover">
        <p class="eyebrow">Shelfmark project export</p>
        <h1>${escapeHtml(project.name)}</h1>
        <p class="meta">Exported ${escapeHtml(exportedAt)} · ${bookmarks.length} linked source${bookmarks.length === 1 ? "" : "s"}</p>
        <div class="section">
          <h2>Project summary</h2>
          <p>${escapeHtml(project.description || "No summary provided.")}</p>
        </div>
        <div class="section">
          <h2>Typed notes and learnings</h2>
          ${escapeHtml(project.learnings || "No typed project notes yet.")
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
            .join("")}
        </div>
      </section>
      ${sourceSections || '<section class="source-card"><h2>No linked sources</h2><p>This project does not have any bookmarks attached yet.</p></section>'}
    </main>
    <script>
      (() => {
        const main = document.querySelector("main");
        const commentInput = document.getElementById("annotationComment");
        const preview = document.getElementById("selectionPreview");
        const saveButton = document.querySelector(".save-copy");
        const pdfButton = document.querySelector(".save-pdf");
        let selectedRange = null;

        function findBlock(node) {
          if (!node) {
            return null;
          }
          const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
          return element ? element.closest("p, li, blockquote") : null;
        }

        function clearSelectionState() {
          selectedRange = null;
          preview.textContent = "No text selected.";
        }

        function updateSelection() {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            clearSelectionState();
            return;
          }

          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;

          if (!container || !main.contains(container)) {
            clearSelectionState();
            return;
          }

          const startBlock = findBlock(range.startContainer);
          const endBlock = findBlock(range.endContainer);
          if (!startBlock || startBlock !== endBlock) {
            clearSelectionState();
            preview.textContent = "Select text inside a single paragraph or bullet.";
            return;
          }

          selectedRange = range.cloneRange();
          const selectedText = selection.toString().replace(/\\s+/g, " ").trim();
          preview.textContent = selectedText ? 'Selected: "' + selectedText.slice(0, 180) + (selectedText.length > 180 ? '…' : '') + '"' : "No text selected.";
        }

        function annotate(color) {
          if (!selectedRange || selectedRange.collapsed) {
            preview.textContent = "Select text before adding a highlight.";
            return;
          }

          const wrapper = document.createElement("span");
          wrapper.className = "annotation annotation-" + color;
          const comment = commentInput.value.trim();
          if (comment) {
            wrapper.dataset.comment = comment;
            wrapper.setAttribute("tabindex", "0");
          }

          const extracted = selectedRange.extractContents();
          if (!extracted.textContent || !extracted.textContent.trim()) {
            preview.textContent = "The current selection could not be highlighted.";
            return;
          }

          wrapper.appendChild(extracted);
          selectedRange.insertNode(wrapper);
          window.getSelection().removeAllRanges();
          commentInput.value = "";
          clearSelectionState();
        }

        document.querySelectorAll(".annotation-panel button[data-color]").forEach((button) => {
          button.addEventListener("click", () => annotate(button.dataset.color));
        });

        document.addEventListener("selectionchange", updateSelection);

        main.addEventListener("click", (event) => {
          const annotation = event.target.closest(".annotation[data-comment]");
          if (!annotation) {
            document.querySelectorAll(".annotation.show-comment").forEach((node) => node.classList.remove("show-comment"));
            return;
          }
          annotation.classList.toggle("show-comment");
        });

        saveButton.addEventListener("click", () => {
          const html = "<!doctype html>\\n" + document.documentElement.outerHTML;
          const blob = new Blob([html], { type: "text/html;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = ${JSON.stringify(`${exportSlug}-annotated.html`)};
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });

        pdfButton.addEventListener("click", () => {
          window.print();
        });

        if (window.location.hash === "#autoprint") {
          window.setTimeout(() => window.print(), 300);
        }
      })();
    </script>
  </body>
</html>`;
}

async function exportProject(projectId) {
  const [projects, bookmarks] = await Promise.all([getProjects(), getBookmarks()]);
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error("Project not found.");
  }

  const linkedBookmarks = bookmarks.filter((bookmark) => (project.bookmarkIds || []).includes(bookmark.id));
  const sources = [];
  for (const bookmark of linkedBookmarks) {
    sources.push(await scrapeBookmarkContent(bookmark));
  }

  return {
    fileName: `${slugifyFilePart(project.name)}-export.html`,
    html: buildProjectExportHtml(project, linkedBookmarks, sources),
    sourceCount: linkedBookmarks.length
  };
}

async function deleteBookmark(id) {
  const bookmarks = await getBookmarks();
  const bookmark = bookmarks.find((item) => item.id === id);
  await setBookmarks(bookmarks.filter((item) => item.id !== id));
  if (bookmark?.contentRef) {
    await deleteContentRecords([bookmark.contentRef]);
  }

  const projects = await getProjects();
  const nextProjects = projects.map((project) => ({
    ...project,
    bookmarkIds: (project.bookmarkIds || []).filter((bookmarkId) => bookmarkId !== id),
    updatedAt: new Date().toISOString()
  }));
  await setProjects(nextProjects);
}

async function updateBookmarkNotes(id, notes) {
  const bookmarks = await getBookmarks();
  const nextBookmarks = bookmarks.map((bookmark) =>
    bookmark.id === id
      ? { ...bookmark, notes: notes.trim(), updatedAt: new Date().toISOString() }
      : bookmark
  );
  await setBookmarks(nextBookmarks);
}

async function upsertProject(payload) {
  const projects = await getProjects();
  const normalizedName = (payload.name || "").trim().toLowerCase();
  const existing =
    projects.find((project) => project.id === payload.id) ||
    (!payload.id && normalizedName
      ? projects.find((project) => project.name.trim().toLowerCase() === normalizedName)
      : null);

  const project = createProjectRecord({
    id: existing?.id || payload.id,
    name: payload.name || existing?.name,
    description: payload.description ?? existing?.description ?? "",
    learnings: payload.learnings ?? existing?.learnings ?? "",
    bookmarkIds: payload.bookmarkIds ?? existing?.bookmarkIds ?? [],
    images: payload.images ?? existing?.images ?? [],
    createdAt: existing?.createdAt,
    updatedAt: new Date().toISOString()
  });

  const nextProjects = existing
    ? projects.map((item) => (item.id === existing.id ? project : item))
    : [project, ...projects];

  await setProjects(nextProjects);
  return project;
}

async function deleteProject(id) {
  const projects = await getProjects();
  await setProjects(projects.filter((project) => project.id !== id));
}

async function assignBookmarksToProject(projectId, bookmarkIds) {
  const projects = await getProjects();
  const nextProjects = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    return {
      ...project,
      bookmarkIds: [...new Set([...(project.bookmarkIds || []), ...bookmarkIds.filter(Boolean)])],
      updatedAt: new Date().toISOString()
    };
  });

  await setProjects(nextProjects);
}

async function removeBookmarkFromProject(projectId, bookmarkId) {
  const projects = await getProjects();
  const nextProjects = projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          bookmarkIds: (project.bookmarkIds || []).filter((id) => id !== bookmarkId),
          updatedAt: new Date().toISOString()
        }
      : project
  );
  await setProjects(nextProjects);
}

async function addProjectImage(projectId, image) {
  const projects = await getProjects();
  const nextProjects = projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          images: [
            {
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              ...image
            },
            ...(project.images || [])
          ],
          updatedAt: new Date().toISOString()
        }
      : project
  );
  await setProjects(nextProjects);
}

async function deleteProjectImage(projectId, imageId) {
  const projects = await getProjects();
  const nextProjects = projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          images: (project.images || []).filter((image) => image.id !== imageId),
          updatedAt: new Date().toISOString()
        }
      : project
  );
  await setProjects(nextProjects);
}

async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: 82
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    await ensureInitialized();
    switch (message?.type) {
      case "SAVE_BOOKMARK": {
        const result = await upsertBookmark(message.payload);
        sendResponse({ ok: true, ...result });
        break;
      }
      case "OPEN_DASHBOARD": {
        await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
        sendResponse({ ok: true });
        break;
      }
      case "UPSERT_PROJECT": {
        const project = await upsertProject(message.payload);
        sendResponse({ ok: true, project });
        break;
      }
      case "DELETE_PROJECT": {
        await deleteProject(message.payload.id);
        sendResponse({ ok: true });
        break;
      }
      case "ASSIGN_BOOKMARKS_TO_PROJECT": {
        await assignBookmarksToProject(message.payload.projectId, message.payload.bookmarkIds || []);
        sendResponse({ ok: true });
        break;
      }
      case "REMOVE_BOOKMARK_FROM_PROJECT": {
        await removeBookmarkFromProject(message.payload.projectId, message.payload.bookmarkId);
        sendResponse({ ok: true });
        break;
      }
      case "ADD_PROJECT_IMAGE": {
        await addProjectImage(message.payload.projectId, message.payload.image);
        sendResponse({ ok: true });
        break;
      }
      case "DELETE_PROJECT_IMAGE": {
        await deleteProjectImage(message.payload.projectId, message.payload.imageId);
        sendResponse({ ok: true });
        break;
      }
      case "EXPORT_PROJECT": {
        const result = await exportProject(message.payload.projectId);
        sendResponse({ ok: true, ...result });
        break;
      }
      case "EXPORT_DATA": {
        const snapshot = await exportDataSnapshot();
        sendResponse({
          ok: true,
          fileName: `shelfmark-backup-${snapshot.exportedAt.slice(0, 10)}.json`,
          data: JSON.stringify(snapshot, null, 2),
          bookmarkCount: snapshot.bookmarks.length,
          projectCount: snapshot.projects.length
        });
        break;
      }
      case "IMPORT_DATA": {
        const result = await importDataSnapshot(message.payload);
        sendResponse({ ok: true, ...result });
        break;
      }
      case "CAPTURE_VISIBLE_TAB": {
        const dataUrl = await captureVisibleTab(message.payload.windowId);
        sendResponse({ ok: true, dataUrl });
        break;
      }
      case "DELETE_BOOKMARK": {
        await deleteBookmark(message.payload.id);
        sendResponse({ ok: true });
        break;
      }
      case "UPDATE_BOOKMARK_NOTES": {
        await updateBookmarkNotes(message.payload.id, message.payload.notes || "");
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unsupported message type." });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});
