import {
  PROJECTS_KEY,
  STORAGE_KEY,
  formatPages,
  formatRuntime,
  matchesFilters,
  sortBookmarks
} from "./shared.js";

const state = {
  view: "bookmarks",
  bookmarks: [],
  projects: [],
  filters: {
    search: "",
    contentType: "all",
    runtime: "all",
    pages: "all",
    tags: []
  },
  sort: "newest",
  selectedIds: new Set(),
  selectedProjectId: null
};

const contentRoot = document.getElementById("contentRoot");
const resultsSummary = document.getElementById("resultsSummary");
const searchInput = document.getElementById("searchInput");
const contentTypeFilter = document.getElementById("contentTypeFilter");
const runtimeFilter = document.getElementById("runtimeFilter");
const pagesFilter = document.getElementById("pagesFilter");
const sortSelect = document.getElementById("sortSelect");
const tagFilters = document.getElementById("tagFilters");
const clearFiltersButton = document.getElementById("clearFilters");
const openSelectedButton = document.getElementById("openSelected");
const selectVisibleButton = document.getElementById("selectVisible");
const clearSelectionButton = document.getElementById("clearSelection");
const addSelectedToProjectButton = document.getElementById("addSelectedToProject");
const projectAssignmentSelect = document.getElementById("projectAssignmentSelect");
const showBookmarksViewButton = document.getElementById("showBookmarksView");
const showProjectsViewButton = document.getElementById("showProjectsView");
const bookmarkControlsCard = document.getElementById("bookmarkControlsCard");
const projectEditorCard = document.getElementById("projectEditorCard");
const bookmarkToolbarActions = document.getElementById("bookmarkToolbarActions");
const projectNameInput = document.getElementById("projectNameInput");
const projectDescriptionInput = document.getElementById("projectDescriptionInput");
const projectLearningsInput = document.getElementById("projectLearningsInput");
const saveProjectButton = document.getElementById("saveProjectButton");
const newProjectButton = document.getElementById("newProjectButton");
const deleteProjectButton = document.getElementById("deleteProjectButton");
const projectImageInput = document.getElementById("projectImageInput");

async function loadData() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, PROJECTS_KEY]);
  state.bookmarks = stored[STORAGE_KEY] || [];
  state.projects = stored[PROJECTS_KEY] || [];

  if (!state.selectedProjectId && state.projects.length) {
    state.selectedProjectId = state.projects[0].id;
  }

  if (state.selectedProjectId && !state.projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = state.projects[0]?.id || null;
  }

  populateProjectAssignment();
  populateProjectForm();
  render();
}

function getSelectedProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function getVisibleBookmarks() {
  return sortBookmarks(
    state.bookmarks.filter((bookmark) => matchesFilters(bookmark, state.filters)),
    state.sort
  );
}

function populateProjectAssignment() {
  projectAssignmentSelect.innerHTML = '<option value="">Add selected to project…</option>';
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectAssignmentSelect.appendChild(option);
  }
}

function populateProjectForm() {
  const project = getSelectedProject();
  projectNameInput.value = project?.name || "";
  projectDescriptionInput.value = project?.description || "";
  projectLearningsInput.value = project?.learnings || "";
  deleteProjectButton.disabled = !project;
}

function renderTagFilters() {
  const tags = [...new Set(state.bookmarks.flatMap((bookmark) => bookmark.tags || []))].sort();
  tagFilters.innerHTML = "";

  if (!tags.length) {
    tagFilters.innerHTML = "<p class=\"meta-line\">Tags will appear as you save bookmarks.</p>";
    return;
  }

  for (const tag of tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.className = `tag-chip ${state.filters.tags.includes(tag) ? "active" : ""}`.trim();
    button.addEventListener("click", () => {
      if (state.filters.tags.includes(tag)) {
        state.filters.tags = state.filters.tags.filter((item) => item !== tag);
      } else {
        state.filters.tags = [...state.filters.tags, tag];
      }
      render();
    });
    tagFilters.appendChild(button);
  }
}

function renderBookmarkCard(bookmark) {
  const projectMembership = state.projects.filter((project) => (project.bookmarkIds || []).includes(bookmark.id));
  const article = document.createElement("article");
  article.className = "bookmark-card";

  article.innerHTML = `
    <div class="bookmark-head">
      <input class="checkbox" type="checkbox" ${state.selectedIds.has(bookmark.id) ? "checked" : ""} aria-label="Select bookmark">
      <div>
        <a class="bookmark-title" href="${bookmark.url}" target="_blank" rel="noreferrer">
          <h3>${escapeHtml(bookmark.title)}</h3>
        </a>
        <p class="bookmark-url">${escapeHtml(bookmark.url)}</p>
      </div>
      <div class="meta-line">${escapeHtml(bookmark.contentType)}</div>
    </div>
    <p class="bookmark-summary">${escapeHtml(bookmark.summary)}</p>
    ${bookmark.notes ? `<p class="bookmark-notes">${escapeHtml(bookmark.notes)}</p>` : ""}
    <div class="tag-row">
      ${(bookmark.tags || []).map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    ${
      projectMembership.length
        ? `<div class="meta-line">${projectMembership.map((project) => `Project: ${escapeHtml(project.name)}`).join(" · ")}</div>`
        : ""
    }
    <div class="meta-line">
      <span>${formatRuntime(bookmark.runtimeMinutes)}</span>
      <span>${formatPages(bookmark.pageCount)}</span>
      <span>Saved ${escapeHtml(new Date(bookmark.createdAt).toLocaleString())}</span>
    </div>
    <div class="bookmark-actions">
      <button class="card-button open-button" type="button">Open</button>
      <button class="card-button edit-notes-button" type="button">Edit note</button>
      <button class="link-button delete-button" type="button">Delete</button>
    </div>
  `;

  article.querySelector(".checkbox").addEventListener("change", (event) => {
    if (event.target.checked) {
      state.selectedIds.add(bookmark.id);
    } else {
      state.selectedIds.delete(bookmark.id);
    }
    updateBookmarkToolbar();
  });

  article.querySelector(".open-button").addEventListener("click", () => {
    chrome.tabs.create({ url: bookmark.url });
  });

  article.querySelector(".edit-notes-button").addEventListener("click", async () => {
    const nextNotes = window.prompt("Update note", bookmark.notes || "");
    if (nextNotes === null) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: "UPDATE_BOOKMARK_NOTES",
      payload: { id: bookmark.id, notes: nextNotes }
    });
    await loadData();
  });

  article.querySelector(".delete-button").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({
      type: "DELETE_BOOKMARK",
      payload: { id: bookmark.id }
    });
    state.selectedIds.delete(bookmark.id);
    await loadData();
  });

  return article;
}

function renderBookmarksView() {
  const visibleBookmarks = getVisibleBookmarks();
  const wrapper = document.createElement("section");
  wrapper.className = "bookmark-list";

  if (!visibleBookmarks.length) {
    wrapper.innerHTML = `
      <section class="empty-state">
        <h3>No bookmarks match the current filters.</h3>
        <p>Save a page from the popup or clear filters to widen the result set.</p>
      </section>
    `;
  } else {
    for (const bookmark of visibleBookmarks) {
      wrapper.appendChild(renderBookmarkCard(bookmark));
    }
  }

  contentRoot.replaceChildren(wrapper);
  resultsSummary.textContent = `${visibleBookmarks.length} of ${state.bookmarks.length} bookmarks`;
}

function renderProjectList(projects) {
  const list = document.createElement("section");
  list.className = "project-list";

  if (!projects.length) {
    list.innerHTML = `
      <section class="empty-state">
        <h3>No projects yet.</h3>
        <p>Create one from the editor to start clustering bookmarks, notes, and images.</p>
      </section>
    `;
    return list;
  }

  for (const project of projects) {
    const card = document.createElement("article");
    card.className = `project-card ${project.id === state.selectedProjectId ? "active" : ""}`.trim();
    card.innerHTML = `
      <p class="eyebrow">Project</p>
      <h3>${escapeHtml(project.name)}</h3>
      <p class="project-text">${escapeHtml(project.description || "No summary yet.")}</p>
      <div class="project-meta">
        <span>${(project.bookmarkIds || []).length} links</span>
        <span>${(project.images || []).length} images</span>
      </div>
    `;
    card.addEventListener("click", () => {
      state.selectedProjectId = project.id;
      populateProjectForm();
      render();
    });
    list.appendChild(card);
  }

  return list;
}

function renderProjectDetail(project) {
  const panel = document.createElement("section");
  panel.className = "project-detail-panel";

  if (!project) {
    panel.innerHTML = `
      <div class="empty-state">
        <h3>Select a project</h3>
        <p>Choose one from the list or create a new project in the editor.</p>
      </div>
    `;
    return panel;
  }

  const linkedBookmarks = state.bookmarks.filter((bookmark) => (project.bookmarkIds || []).includes(bookmark.id));

  panel.innerHTML = `
    <div class="project-header-actions">
      <div>
        <p class="eyebrow">Project detail</p>
        <h3>${escapeHtml(project.name)}</h3>
      </div>
      <div class="project-header-actions">
        <button class="ghost-button export-project" type="button">Export project</button>
        <button class="ghost-button export-project-pdf" type="button">Export PDF</button>
        <button class="primary-button open-project-links" type="button" ${linkedBookmarks.length ? "" : "disabled"}>Open all links</button>
      </div>
    </div>
    <section class="project-detail-section">
      <h4>Summary</h4>
      <p class="project-text">${escapeHtml(project.description || "No summary yet.")}</p>
    </section>
    <section class="project-detail-section">
      <h4>Learnings</h4>
      <p class="project-text">${escapeHtml(project.learnings || "No learnings saved yet.")}</p>
    </section>
    <section class="project-detail-section">
      <h4>Linked bookmarks</h4>
      <div class="project-bookmark-list">
        ${
          linkedBookmarks.length
            ? linkedBookmarks
                .map(
                  (bookmark) => `
                    <article class="project-bookmark-row" data-bookmark-id="${bookmark.id}">
                      <a class="project-link" href="${bookmark.url}" target="_blank" rel="noreferrer"><strong>${escapeHtml(bookmark.title)}</strong></a>
                      <p class="project-text">${escapeHtml(bookmark.summary)}</p>
                      <div class="project-bookmark-actions">
                        <button class="card-button project-open-bookmark" type="button">Open</button>
                        <button class="link-button project-remove-bookmark" type="button">Remove from project</button>
                      </div>
                    </article>
                  `
                )
                .join("")
            : '<p class="project-empty">No bookmarks linked yet. Use the Bookmarks view to add selected items.</p>'
        }
      </div>
    </section>
    <section class="project-detail-section">
      <h4>Images</h4>
      <div class="project-image-grid">
        ${
          (project.images || []).length
            ? project.images
                .map(
                  (image) => `
                    <article class="project-image-card" data-image-id="${image.id}">
                      <img class="project-image" src="${image.dataUrl}" alt="${escapeHtml(image.name || "Project image")}">
                      <div>
                        <strong>${escapeHtml(image.name || "Image")}</strong>
                        <p class="project-text">${escapeHtml(image.caption || "")}</p>
                      </div>
                      <button class="link-button project-delete-image" type="button">Delete image</button>
                    </article>
                  `
                )
                .join("")
            : '<p class="project-empty">No images yet. Upload one here or capture a screenshot from the popup.</p>'
        }
      </div>
    </section>
  `;

  panel.querySelector(".open-project-links")?.addEventListener("click", async () => {
    for (const bookmark of linkedBookmarks) {
      await chrome.tabs.create({ url: bookmark.url });
    }
  });

  panel.querySelector(".export-project")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Exporting…";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "EXPORT_PROJECT",
        payload: { projectId: project.id }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Project export failed.");
      }

      downloadTextFile(response.fileName, response.html, "text/html");
      button.textContent = `Exported ${response.sourceCount} source${response.sourceCount === 1 ? "" : "s"}`;
      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1600);
    } catch (error) {
      window.alert(String(error));
      button.textContent = originalText;
      button.disabled = false;
    }
  });

  panel.querySelector(".export-project-pdf")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing PDF…";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "EXPORT_PROJECT",
        payload: { projectId: project.id }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "PDF export preparation failed.");
      }

      openHtmlInNewTab(response.html, "#autoprint");
      button.textContent = "Opened print dialog";
      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1600);
    } catch (error) {
      window.alert(String(error));
      button.textContent = originalText;
      button.disabled = false;
    }
  });

  panel.querySelectorAll(".project-bookmark-row").forEach((row) => {
    const bookmarkId = row.getAttribute("data-bookmark-id");
    const bookmark = linkedBookmarks.find((item) => item.id === bookmarkId);
    row.querySelector(".project-open-bookmark")?.addEventListener("click", () => {
      if (bookmark) {
        chrome.tabs.create({ url: bookmark.url });
      }
    });
    row.querySelector(".project-remove-bookmark")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "REMOVE_BOOKMARK_FROM_PROJECT",
        payload: { projectId: project.id, bookmarkId }
      });
      await loadData();
    });
  });

  panel.querySelectorAll(".project-image-card").forEach((card) => {
    const imageId = card.getAttribute("data-image-id");
    card.querySelector(".project-delete-image")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "DELETE_PROJECT_IMAGE",
        payload: { projectId: project.id, imageId }
      });
      await loadData();
    });
  });

  return panel;
}

function renderProjectsView() {
  const container = document.createElement("section");
  container.className = "project-main-grid";
  container.appendChild(renderProjectList(state.projects));
  container.appendChild(renderProjectDetail(getSelectedProject()));
  contentRoot.replaceChildren(container);
  resultsSummary.textContent = `${state.projects.length} project${state.projects.length === 1 ? "" : "s"}`;
}

function updateBookmarkToolbar() {
  const selectedCount = state.selectedIds.size;
  openSelectedButton.disabled = selectedCount === 0;
  addSelectedToProjectButton.disabled = selectedCount === 0 || !projectAssignmentSelect.value;
  openSelectedButton.textContent = selectedCount ? `Open selected (${selectedCount})` : "Open selected";
}

function render() {
  bookmarkControlsCard.classList.toggle("hidden", state.view !== "bookmarks");
  projectEditorCard.classList.toggle("hidden", state.view !== "projects");
  bookmarkToolbarActions.classList.toggle("hidden", state.view !== "bookmarks");
  showBookmarksViewButton.classList.toggle("active", state.view === "bookmarks");
  showProjectsViewButton.classList.toggle("active", state.view === "projects");

  if (state.view === "bookmarks") {
    renderTagFilters();
    renderBookmarksView();
  } else {
    renderProjectsView();
  }

  updateBookmarkToolbar();
}

async function saveProject() {
  const payload = {
    id: state.selectedProjectId || undefined,
    name: projectNameInput.value.trim(),
    description: projectDescriptionInput.value.trim(),
    learnings: projectLearningsInput.value.trim()
  };

  if (!payload.name) {
    window.alert("Project name is required.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "UPSERT_PROJECT",
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Project save failed.");
  }

  state.selectedProjectId = response.project.id;
  await loadData();
}

async function resizeImageFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Image load failed."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed."));
    img.src = dataUrl;
  });

  const maxSize = 1600;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function resetProjectEditor() {
  state.selectedProjectId = null;
  populateProjectForm();
  render();
}

function downloadTextFile(fileName, contents, mimeType) {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openHtmlInNewTab(contents, hash = "") {
  const blob = new Blob([contents], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url: `${url}${hash}` });
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wireControls() {
  showBookmarksViewButton.addEventListener("click", () => {
    state.view = "bookmarks";
    render();
  });

  showProjectsViewButton.addEventListener("click", () => {
    state.view = "projects";
    render();
  });

  searchInput.addEventListener("input", () => {
    state.filters.search = searchInput.value;
    render();
  });

  contentTypeFilter.addEventListener("change", () => {
    state.filters.contentType = contentTypeFilter.value;
    render();
  });

  runtimeFilter.addEventListener("change", () => {
    state.filters.runtime = runtimeFilter.value;
    render();
  });

  pagesFilter.addEventListener("change", () => {
    state.filters.pages = pagesFilter.value;
    render();
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    render();
  });

  clearFiltersButton.addEventListener("click", () => {
    state.filters = {
      search: "",
      contentType: "all",
      runtime: "all",
      pages: "all",
      tags: []
    };
    searchInput.value = "";
    contentTypeFilter.value = "all";
    runtimeFilter.value = "all";
    pagesFilter.value = "all";
    render();
  });

  projectAssignmentSelect.addEventListener("change", () => {
    updateBookmarkToolbar();
  });

  addSelectedToProjectButton.addEventListener("click", async () => {
    if (!projectAssignmentSelect.value || !state.selectedIds.size) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: "ASSIGN_BOOKMARKS_TO_PROJECT",
      payload: {
        projectId: projectAssignmentSelect.value,
        bookmarkIds: [...state.selectedIds]
      }
    });
    await loadData();
  });

  selectVisibleButton.addEventListener("click", () => {
    for (const bookmark of getVisibleBookmarks()) {
      state.selectedIds.add(bookmark.id);
    }
    render();
  });

  clearSelectionButton.addEventListener("click", () => {
    state.selectedIds.clear();
    render();
  });

  openSelectedButton.addEventListener("click", async () => {
    const selectedBookmarks = state.bookmarks.filter((bookmark) => state.selectedIds.has(bookmark.id));
    for (const bookmark of selectedBookmarks) {
      await chrome.tabs.create({ url: bookmark.url });
    }
  });

  newProjectButton.addEventListener("click", () => {
    resetProjectEditor();
    projectNameInput.focus();
  });

  saveProjectButton.addEventListener("click", async () => {
    try {
      await saveProject();
      state.view = "projects";
      render();
    } catch (error) {
      window.alert(String(error));
    }
  });

  deleteProjectButton.addEventListener("click", async () => {
    const project = getSelectedProject();
    if (!project) {
      return;
    }
    const confirmed = window.confirm(`Delete project "${project.name}"?`);
    if (!confirmed) {
      return;
    }
    await chrome.runtime.sendMessage({
      type: "DELETE_PROJECT",
      payload: { id: project.id }
    });
    state.selectedProjectId = null;
    await loadData();
  });

  projectImageInput.addEventListener("change", async () => {
    const project = getSelectedProject();
    if (!project) {
      window.alert("Save or select a project before adding images.");
      projectImageInput.value = "";
      return;
    }

    const files = [...projectImageInput.files || []];
    for (const file of files) {
      const dataUrl = await resizeImageFile(file);
      await chrome.runtime.sendMessage({
        type: "ADD_PROJECT_IMAGE",
        payload: {
          projectId: project.id,
          image: {
            name: file.name.replace(/\.[^.]+$/, ""),
            caption: "",
            dataUrl
          }
        }
      });
    }

    projectImageInput.value = "";
    await loadData();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes[STORAGE_KEY] || changes[PROJECTS_KEY])) {
    loadData();
  }
});

wireControls();
loadData();
