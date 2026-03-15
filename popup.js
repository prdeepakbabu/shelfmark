import { PROJECTS_KEY } from "./shared.js";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractCurrentMetadata(tab) {
  if (!tab?.id) {
    return {};
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PAGE_METADATA" });
    if (response?.ok) {
      return response.metadata;
    }
  } catch {
    return {
      title: tab.title,
      url: tab.url
    };
  }

  return {
    title: tab.title,
    url: tab.url
  };
}

const currentTitle = document.getElementById("currentTitle");
const currentUrl = document.getElementById("currentUrl");
const notesField = document.getElementById("notes");
const manualUrlField = document.getElementById("manualUrl");
const projectSelect = document.getElementById("projectSelect");
const newProjectNameField = document.getElementById("newProjectName");
const captureScreenshotField = document.getElementById("captureScreenshot");
const saveCurrentButton = document.getElementById("saveCurrentTab");
const saveManualButton = document.getElementById("saveManualUrl");
const openDashboardButton = document.getElementById("openDashboard");
const statusNode = document.getElementById("status");

let activeTab = null;
let projects = [];

function setStatus(message, kind = "") {
  statusNode.textContent = message;
  statusNode.className = `status ${kind}`.trim();
}

async function saveBookmark(payload) {
  const response = await chrome.runtime.sendMessage({ type: "SAVE_BOOKMARK", payload });
  if (!response?.ok) {
    throw new Error(response?.error || "Bookmark save failed.");
  }

  return response;
}

async function loadProjects() {
  const stored = await chrome.storage.local.get(PROJECTS_KEY);
  projects = stored[PROJECTS_KEY] || [];
  projectSelect.innerHTML = '<option value="">No project</option>';

  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  }
}

async function ensureProject() {
  const newProjectName = newProjectNameField.value.trim();
  if (newProjectName) {
    const response = await chrome.runtime.sendMessage({
      type: "UPSERT_PROJECT",
      payload: {
        name: newProjectName,
        description: "",
        learnings: ""
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Project creation failed.");
    }
    await loadProjects();
    projectSelect.value = response.project.id;
    newProjectNameField.value = "";
    return response.project;
  }

  return projects.find((project) => project.id === projectSelect.value) || null;
}

async function maybeAttachBookmarkArtifacts(bookmark, sourceLabel) {
  const chosenProject = await ensureProject();
  const wantsScreenshot = captureScreenshotField.checked;

  if (!chosenProject && wantsScreenshot) {
    throw new Error("Choose or create a project before adding screenshots.");
  }

  if (!chosenProject) {
    return { projectName: "" };
  }

  await chrome.runtime.sendMessage({
    type: "ASSIGN_BOOKMARKS_TO_PROJECT",
    payload: {
      projectId: chosenProject.id,
      bookmarkIds: [bookmark.id]
    }
  });

  if (wantsScreenshot && activeTab?.windowId) {
    const captureResponse = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE_TAB",
      payload: { windowId: activeTab.windowId }
    });

    if (!captureResponse?.ok || !captureResponse.dataUrl) {
      throw new Error("Screenshot capture failed.");
    }

    await chrome.runtime.sendMessage({
      type: "ADD_PROJECT_IMAGE",
      payload: {
        projectId: chosenProject.id,
        image: {
          name: `${sourceLabel} screenshot`,
          caption: notesField.value.trim(),
          dataUrl: captureResponse.dataUrl,
          sourceUrl: bookmark.url
        }
      }
    });
  }

  return { projectName: chosenProject.name };
}

saveCurrentButton.addEventListener("click", async () => {
  if (!activeTab?.url) {
    setStatus("This page cannot be bookmarked from the extension popup.", "error");
    return;
  }

  saveCurrentButton.disabled = true;
  setStatus("Extracting page details…");

  try {
    const metadata = await extractCurrentMetadata(activeTab);
    const response = await saveBookmark({
      url: activeTab.url,
      notes: notesField.value,
      metadata,
      source: "current-tab"
    });
    const artifactResult = await maybeAttachBookmarkArtifacts(response.bookmark, activeTab.title || "Current page");
    const baseMessage = response.status === "updated" ? "Bookmark updated." : "Bookmark saved.";
    const suffix = artifactResult.projectName ? ` Added to ${artifactResult.projectName}.` : "";
    setStatus(`${baseMessage}${suffix}`, "success");
  } catch (error) {
    setStatus(String(error), "error");
  } finally {
    saveCurrentButton.disabled = false;
  }
});

saveManualButton.addEventListener("click", async () => {
  const url = manualUrlField.value.trim();
  if (!url) {
    setStatus("Paste a URL to bookmark it.", "error");
    return;
  }

  saveManualButton.disabled = true;
  setStatus("Fetching URL metadata…");

  try {
    const response = await saveBookmark({
      url,
      notes: notesField.value,
      metadata: {},
      source: "manual"
    });
    const artifactResult = await maybeAttachBookmarkArtifacts(response.bookmark, "Saved page");
    const baseMessage = response.status === "updated" ? "Bookmark updated." : "Bookmark saved.";
    const suffix = artifactResult.projectName ? ` Added to ${artifactResult.projectName}.` : "";
    setStatus(`${baseMessage}${suffix}`, "success");
  } catch (error) {
    setStatus(String(error), "error");
  } finally {
    saveManualButton.disabled = false;
  }
});

openDashboardButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  window.close();
});

document.addEventListener("DOMContentLoaded", async () => {
  activeTab = await getActiveTab();
  currentTitle.textContent = activeTab?.title || "No active tab detected";
  currentUrl.textContent = activeTab?.url || "Open a standard web page to save it.";
  await loadProjects();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[PROJECTS_KEY]) {
    loadProjects();
  }
});
