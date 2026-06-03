const state = {
  projects: [],
  activeProjectId: null,
  activeNoteId: null,
  saveTimer: null,
  saveQueue: Promise.resolve(),
  isDirty: false,
  allowDestructiveSave: false,
  serverAvailable: false,
  discussionUndoStack: [],
  isRenderingDiscussion: false,
};

const themeKey = "tc-notes-theme";
const localBackupKey = "tc-notes-backup-v1";

const els = {
  projectList: document.getElementById("projectList"),
  projectTabs: document.getElementById("projectTabs"),
  newProjectButton: document.getElementById("newProjectButton"),
  archiveNotesButton: document.getElementById("archiveNotesButton"),
  themeToggleButton: document.getElementById("themeToggleButton"),
  projectDialog: document.getElementById("projectDialog"),
  projectForm: document.getElementById("projectForm"),
  cancelProjectButton: document.getElementById("cancelProjectButton"),
  clientNameInput: document.getElementById("clientNameInput"),
  projectNameInput: document.getElementById("projectNameInput"),
  projectTitle: document.getElementById("projectTitle"),
  saveStatus: document.getElementById("saveStatus"),
  newNoteButton: document.getElementById("newNoteButton"),
  noteHeader: document.getElementById("noteHeader"),
  noteTitle: document.getElementById("noteTitle"),
  noteDate: document.getElementById("noteDate"),
  meetingInPerson: document.getElementById("meetingInPerson"),
  meetingVirtual: document.getElementById("meetingVirtual"),
  noteAttendees: document.getElementById("noteAttendees"),
  attendeePasteZone: document.getElementById("attendeePasteZone"),
  attendeeImagePreview: document.getElementById("attendeeImagePreview"),
  removeAttendeeImageButton: document.getElementById("removeAttendeeImageButton"),
  noteDiscussion: document.getElementById("noteDiscussion"),
  createReportButton: document.getElementById("createReportButton"),
  emailReportButton: document.getElementById("emailReportButton"),
  downloadReportButton: document.getElementById("downloadReportButton"),
  downloadActionItemsButton: document.getElementById("downloadActionItemsButton"),
  finalReport: document.getElementById("finalReport"),
  searchInput: document.getElementById("searchInput"),
  questionInput: document.getElementById("questionInput"),
  askButton: document.getElementById("askButton"),
  answerBox: document.getElementById("answerBox"),
  notesTimeline: document.getElementById("notesTimeline"),
  noteCount: document.getElementById("noteCount"),
  projectHistoryTitle: document.getElementById("projectHistoryTitle"),
};

function applySavedTheme() {
  const savedTheme = localStorage.getItem(themeKey);
  const theme = ["classic", "studio", "warm"].includes(savedTheme) ? savedTheme : "classic";
  document.body.dataset.theme = theme;
  const labels = {
    classic: "Try Studio Look",
    studio: "Try Warm Look",
    warm: "Use Classic Look",
  };
  els.themeToggleButton.textContent = labels[theme];
}

function toggleTheme() {
  const themes = ["classic", "studio", "warm"];
  const currentIndex = themes.indexOf(document.body.dataset.theme || "classic");
  const nextTheme = themes[(currentIndex + 1) % themes.length];
  localStorage.setItem(themeKey, nextTheme);
  applySavedTheme();
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function activeNote() {
  return activeProject()?.notes.find((note) => note.id === state.activeNoteId);
}

function projectLabel(project) {
  const client = String(project.clientName || "").trim();
  const projectName = String(project.projectName || project.name || "").trim();
  if (client && projectName) return `${client} / ${projectName}`;
  return projectName || client || "Untitled project";
}

function newNote() {
  return {
    id: uid("note"),
    title: "Untitled meeting",
    date: today(),
    meetingType: "",
    attendees: "",
    attendeeImage: "",
    discussion: "- ",
    actionItems: [],
    completedActionItems: [],
    decisionItems: [],
    finalReport: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadData() {
  const data = await loadServerData();
  const serverProjects = (data.projects || []).map(normalizeProject);
  const localBackup = readLocalBackup();
  const usedLocalBackup = shouldUseLocalBackup(localBackup, serverProjects);

  state.projects = usedLocalBackup ? localBackup.projects : serverProjects;

  if (state.projects.length === 0) {
    state.projects = [
      {
        id: uid("project"),
        clientName: "General",
        projectName: "Notes",
        createdAt: new Date().toISOString(),
        notes: [],
      },
    ];
    await saveData(true);
  }

  persistLocalBackup();
  state.activeProjectId = state.projects[0].id;
  ensureProjectHasNote();
  render();

  if (usedLocalBackup) {
    state.isDirty = true;
    await saveData(true);
  }
}

async function loadServerData() {
  try {
    const response = await fetch("/api/notes");
    if (!response.ok) throw new Error("Server notes unavailable.");
    state.serverAvailable = true;
    return await response.json();
  } catch (error) {
    state.serverAvailable = false;
    return { projects: [] };
  }
}

function readLocalBackup() {
  try {
    const backup = JSON.parse(localStorage.getItem(localBackupKey) || "{}");
    return {
      savedAt: backup.savedAt || "",
      projects: Array.isArray(backup.projects) ? backup.projects.map(normalizeProject) : [],
    };
  } catch (error) {
    return { savedAt: "", projects: [] };
  }
}

function persistLocalBackup() {
  try {
    localStorage.setItem(
      localBackupKey,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        projects: state.projects,
      })
    );
  } catch (error) {
    // The normal file save still runs if browser storage is unavailable.
  }
}

function shouldUseLocalBackup(localBackup, serverProjects) {
  const localProjects = localBackup.projects || [];
  const localStats = getProjectStats(localProjects);
  const serverStats = getProjectStats(serverProjects);

  if (!localProjects.length) return false;
  if (!serverProjects.length) return localStats.meaningfulTextLength > 20;

  const localHasMoreProjects = localStats.projectCount > serverStats.projectCount;
  const localHasMoreNotes = localStats.noteCount > serverStats.noteCount;
  const localHasAtLeastSameShape = localStats.projectCount >= serverStats.projectCount && localStats.noteCount >= serverStats.noteCount;
  const localHasMoreContent = localStats.meaningfulTextLength > serverStats.meaningfulTextLength + 20;
  const serverLooksBlank = serverStats.meaningfulTextLength < 20;

  return localHasMoreProjects || localHasMoreNotes || (localHasAtLeastSameShape && localHasMoreContent && serverLooksBlank);
}

function latestProjectChange(projects) {
  return projects.reduce((latest, project) => {
    const projectTime = Date.parse(project.createdAt || "") || 0;
    const noteTime = (project.notes || []).reduce((noteLatest, note) => {
      const updatedAt = Date.parse(note.updatedAt || note.createdAt || "") || 0;
      return Math.max(noteLatest, updatedAt);
    }, 0);
    return Math.max(latest, projectTime, noteTime);
  }, 0);
}

function projectTextLength(projects) {
  return getProjectStats(projects).meaningfulTextLength;
}

function getProjectStats(projects) {
  return projects.reduce(
    (stats, project) => {
      stats.projectCount += 1;
      const notes = Array.isArray(project.notes) ? project.notes : [];
      stats.noteCount += notes.length;

      notes.forEach((note) => {
        stats.meaningfulTextLength += [
          project.clientName,
          project.projectName,
          project.name,
          note.title,
          note.attendees,
          note.discussion,
          note.finalReport,
          ...(Array.isArray(note.actionItems) ? note.actionItems : []),
          ...(Array.isArray(note.decisionItems) ? note.decisionItems : []),
        ].join(" ").replace(/^[-\s]+$/, "").trim().length;
      });

      return stats;
    },
    { projectCount: 0, noteCount: 0, meaningfulTextLength: 0 }
  );
}

function normalizeProject(project) {
  const fallbackName = String(project.name || "").trim();
  return {
    ...project,
    clientName: project.clientName || "",
    projectName: project.projectName || fallbackName || "Untitled project",
    notes: (project.notes || []).map(normalizeNote),
  };
}

function normalizeNote(note) {
  const decisionItems = Array.isArray(note.decisionItems)
    ? note.decisionItems
    : parseDiscussionItems(note.decisions || "").map((item) => item.text);
  const actionItems = Array.isArray(note.actionItems)
    ? note.actionItems
    : parseDiscussionItems(note.followups || "").map((item) => item.text);
  const completedActionItems = Array.isArray(note.completedActionItems) ? note.completedActionItems : [];

  return {
    ...newNote(),
    ...note,
    discussion: toBulletText(note.discussion || note.body || ""),
    actionItems,
    completedActionItems,
    decisionItems,
    finalReport: note.finalReport || "",
    meetingType: note.meetingType || "",
    attendeeImage: note.attendeeImage || "",
  };
}

async function saveData(silent = false, options = {}) {
  if (!state.isDirty && !silent) {
    els.saveStatus.textContent = "Saved";
    return;
  }

  if (!silent) {
    els.saveStatus.textContent = "Saving...";
  }

  persistLocalBackup();

  try {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projects: state.projects,
        allowDestructive: Boolean(options.allowDestructive),
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Could not save notes.");
    }

    state.serverAvailable = true;
    els.saveStatus.textContent = "Saved";
  } catch (error) {
    state.serverAvailable = false;
    els.saveStatus.textContent = "Saved locally";
  }

  state.isDirty = false;
  state.allowDestructiveSave = false;
}

function scheduleSave() {
  els.saveStatus.textContent = "Unsaved";
  state.isDirty = true;
  persistLocalBackup();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveQueue = state.saveQueue
      .catch(() => {})
      .then(() => saveData(false, { allowDestructive: state.allowDestructiveSave }))
      .catch(() => {
        els.saveStatus.textContent = "Saved locally";
      });
  }, 75);
}

function saveBeforeUnload() {
  if (!state.projects.length || !state.isDirty) return;

  persistLocalBackup();
  clearTimeout(state.saveTimer);

  const payload = JSON.stringify({
    projects: state.projects,
    allowDestructive: state.allowDestructiveSave,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/notes", new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  });
}

function ensureProjectHasNote() {
  const project = activeProject();
  if (!project) return;

  if (project.notes.length === 0) {
    const note = newNote();
    project.notes.unshift(note);
    state.activeNoteId = note.id;
    scheduleSave();
    return;
  }

  state.activeNoteId = project.notes[0].id;
}

function render() {
  renderProjects();
  renderProjectTabs();
  renderEditor();
  renderTimeline();
}

function setActiveProject(projectId) {
  state.activeProjectId = projectId;
  els.searchInput.value = "";
  ensureProjectHasNote();
  render();
}

function renderProjects() {
  els.projectList.innerHTML = "";

  state.projects.forEach((project) => {
    const row = document.createElement("div");
    row.className = `project-row${project.id === state.activeProjectId ? " active" : ""}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-item";
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(projectLabel(project))}</strong>
        <small>${project.notes.length} ${project.notes.length === 1 ? "note" : "notes"}</small>
      </span>
    `;
    button.addEventListener("click", () => setActiveProject(project.id));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "project-remove";
    removeButton.title = `Remove ${projectLabel(project)}`;
    removeButton.setAttribute("aria-label", `Remove ${projectLabel(project)}`);
    removeButton.textContent = "x";
    removeButton.addEventListener("click", () => removeProject(project.id));

    row.append(button, removeButton);
    els.projectList.appendChild(row);
  });
}

function renderProjectTabs() {
  els.projectTabs.innerHTML = "";

  state.projects.forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-tab${project.id === state.activeProjectId ? " active" : ""}`;
    button.textContent = projectLabel(project);
    button.addEventListener("click", () => setActiveProject(project.id));
    els.projectTabs.appendChild(button);
  });
}

function renderEditor() {
  const project = activeProject();
  const note = activeNote();
  const label = project ? projectLabel(project) : "Select a project";

  els.projectTitle.textContent = label;
  els.projectHistoryTitle.textContent = project ? `All Notes For ${label}` : "All Notes For This Project";
  els.noteHeader.textContent = note?.title || "Meeting Notes";
  els.noteTitle.value = note?.title || "";
  els.noteDate.value = note?.date || today();
  els.meetingInPerson.checked = note?.meetingType === "In-Person";
  els.meetingVirtual.checked = note?.meetingType === "Virtual";
  els.noteAttendees.value = note?.attendees || "";
  renderDiscussionEditor(note?.discussion || "");
  state.discussionUndoStack = [];
  renderFinalReport(note);
  renderAttendeeImage(note?.attendeeImage || "");

  const hasProject = Boolean(project);
  [els.newNoteButton, els.noteTitle, els.noteDate, els.meetingInPerson, els.meetingVirtual, els.noteAttendees, els.askButton, els.createReportButton, els.emailReportButton, els.downloadReportButton, els.downloadActionItemsButton].forEach((el) => {
    el.disabled = !hasProject;
  });
  els.noteDiscussion.setAttribute("contenteditable", hasProject ? "true" : "false");
}

function renderAttendeeImage(src) {
  els.attendeeImagePreview.src = src;
  els.attendeePasteZone.classList.toggle("has-image", Boolean(src));
}

function renderTimeline() {
  const project = activeProject();
  const query = els.searchInput.value.trim().toLowerCase();
  els.notesTimeline.innerHTML = "";

  if (!project) {
    els.noteCount.textContent = "0 notes";
    return;
  }

  const filteredNotes = project.notes.filter((note) => {
    const haystack = getNoteSearchText(note).toLowerCase();
    return !query || haystack.includes(query);
  });

  els.noteCount.textContent = `${filteredNotes.length} ${filteredNotes.length === 1 ? "note" : "notes"}`;

  if (filteredNotes.length === 0) {
    els.notesTimeline.innerHTML = `<div class="empty-state">No notes match that search.</div>`;
    return;
  }

  filteredNotes.forEach((note) => {
    const card = document.createElement("div");
    card.className = `note-card${note.id === state.activeNoteId ? " active" : ""}`;
    const preview = note.discussion.trim() || "No details added yet.";
    card.innerHTML = `
      <button class="note-open" type="button">
        <div class="note-title-row">
          <strong>${escapeHtml(note.title || "Untitled meeting")}</strong>
          <span class="note-meta">${escapeHtml(note.date || "")}</span>
        </div>
        <div class="note-meta">${escapeHtml(note.attendees || "No attendees listed")}</div>
        <div class="note-preview">${escapeHtml(preview.slice(0, 190))}${preview.length > 190 ? "..." : ""}</div>
      </button>
      <button class="note-delete" type="button">Delete Note</button>
    `;
    card.querySelector(".note-open").addEventListener("click", () => {
      state.activeNoteId = note.id;
      renderEditor();
      renderTimeline();
    });
    card.querySelector(".note-delete").addEventListener("click", () => removeNote(note.id));
    els.notesTimeline.appendChild(card);
  });
}

function removeNote(noteId) {
  const project = activeProject();
  if (!project) return;

  const note = project.notes.find((item) => item.id === noteId);
  if (!note) return;

  if (!window.confirm(`Delete "${note.title || "Untitled meeting"}"?`)) return;

  project.notes = project.notes.filter((item) => item.id !== noteId);
  if (state.activeNoteId === noteId) {
    state.activeNoteId = project.notes[0]?.id || null;
    ensureProjectHasNote();
  }

  render();
  scheduleSave();
}

async function createFinalReport() {
  const note = activeNote();
  const project = activeProject();
  if (!note || !project) return;

  els.createReportButton.disabled = true;
  els.finalReport.textContent = "Organizing your notes...";

  try {
    if (state.isDirty) {
      await saveData();
    }

    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        noteId: note.id,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not create the report.");
    }

    applyReportToNote(data.report, data.actionItems || [], data.clientDecisions || []);
  } catch (error) {
    const parsed = parseLocalReportNotes(note.discussion);
    applyReportToNote(buildLocalReport(project, note, parsed), parsed.actionItems, parsed.clientDecisions);
  } finally {
    els.createReportButton.disabled = false;
  }
}

function applyReportToNote(report, actionItems, clientDecisions) {
  const note = activeNote();
  if (!note) return;

  note.finalReport = report;
  note.actionItems = actionItems;
  note.completedActionItems = (note.completedActionItems || []).filter((item) => actionItems.includes(item));
  note.decisionItems = clientDecisions;
  note.updatedAt = new Date().toISOString();
  renderFinalReport(note);
  renderTimeline();
  scheduleSave();
}

function renderFinalReport(note) {
  els.finalReport.innerHTML = "";

  if (!note?.finalReport) {
    els.finalReport.textContent = "Final report will appear here after your notes are done.";
    return;
  }

  const project = activeProject();
  const parsed = parseLocalReportNotes(note.discussion);
  const decisions = note.decisionItems?.length ? note.decisionItems : parsed.clientDecisions;
  const notes = parsed.notes;

  const header = document.createElement("div");
  header.className = "report-heading";
  header.innerHTML = `
    <div class="report-project">${escapeHtml(project ? projectLabel(project) : "Project")}</div>
    <div class="report-date">${escapeHtml(note.date || "No date listed")}</div>
  `;

  const checklist = document.createElement("div");
  checklist.className = "report-section report-action-checklist";
  checklist.innerHTML = `<h4>Action Items</h4>`;

  const actionItems = note.actionItems || [];
  if (actionItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "report-empty";
    empty.textContent = "None noted";
    checklist.appendChild(empty);
  } else {
    actionItems.forEach((item) => {
      const label = document.createElement("label");
      label.className = "report-action-item";
      label.innerHTML = `
        <input type="checkbox" ${note.completedActionItems?.includes(item) ? "checked" : ""} />
        <span>${escapeHtml(item)}</span>
      `;
      label.querySelector("input").addEventListener("change", (event) => {
        toggleCompletedActionItem(item, event.target.checked);
      });
      checklist.appendChild(label);
    });
  }

  const decisionsSection = document.createElement("div");
  decisionsSection.className = "report-section";
  decisionsSection.innerHTML = `<h4>Decisions</h4>`;
  decisionsSection.appendChild(renderReportList(decisions));

  const notesSection = document.createElement("div");
  notesSection.className = "report-section";
  notesSection.innerHTML = `<h4>Notes</h4>`;
  notesSection.appendChild(renderReportList(notes));

  els.finalReport.append(header, checklist, decisionsSection, notesSection);
}

function renderReportList(items) {
  const list = document.createElement("ul");
  list.className = "report-list";

  if (!items.length) {
    const item = document.createElement("li");
    item.className = "report-empty";
    item.textContent = "None noted";
    list.appendChild(item);
    return list;
  }

  items.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.appendChild(item);
  });

  return list;
}

function toggleCompletedActionItem(item, checked) {
  const note = activeNote();
  if (!note) return;

  note.completedActionItems = Array.isArray(note.completedActionItems) ? note.completedActionItems : [];
  if (checked && !note.completedActionItems.includes(item)) {
    note.completedActionItems.push(item);
  }
  if (!checked) {
    note.completedActionItems = note.completedActionItems.filter((completed) => completed !== item);
  }

  note.updatedAt = new Date().toISOString();
  scheduleSave();
}

function removeActionItemsSection(report) {
  const lines = String(report || "").split(/\r?\n/);
  const output = [];
  let skipping = false;

  lines.forEach((line) => {
    if (/^##\s+Action Items\s*$/i.test(line.trim())) {
      skipping = true;
      return;
    }

    if (skipping && /^##\s+/.test(line.trim())) {
      skipping = false;
    }

    if (!skipping) output.push(line);
  });

  return output.join("\n").trim();
}

async function emailFinalReport() {
  const note = activeNote();
  const project = activeProject();
  if (!note || !project) return;

  if (!note.finalReport) {
    window.alert("Create the final report first.");
    return;
  }

  if (state.isDirty) {
    await saveData().catch(() => {});
  }

  try {
    const response = await fetch("/api/email-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        noteId: note.id,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open an email draft.");
    window.alert("Email draft opened with the PDF attached.");
  } catch (error) {
    const downloadedPdf = await downloadReportPdf();
    const subject = `${projectLabel(project)} - ${note.title || "Meeting Report"}`;
    const attachmentNote = downloadedPdf
      ? "A PDF copy of this report has been downloaded. Attach it to this email before sending."
      : "The PDF attachment could not be created because the local server is not running. The report text is included below.";
    const body = `${attachmentNote}\n\n${buildEmailReportText(project, note)}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}

async function downloadReportPdf() {
  const note = activeNote();
  const project = activeProject();
  if (!note || !project) return;

  try {
    const response = await fetch("/api/report-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        noteId: note.id,
      }),
    });
    if (!response.ok) return downloadBrowserReportPdf(project, note);

    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${projectLabel(project)} - ${note.title || "Meeting Report"}.pdf`.replace(/[<>:"/\\|?*]+/g, " ");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    return true;
  } catch (error) {
    return downloadBrowserReportPdf(project, note);
  }
}

function downloadFinalReport() {
  const note = activeNote();
  const project = activeProject();
  if (!note || !project) return;

  if (!note.finalReport) {
    window.alert("Create the final report first.");
    return;
  }

  downloadBrowserReportPdf(project, note);
}

function downloadActionItems() {
  const note = activeNote();
  const project = activeProject();
  if (!note || !project) return;

  const parsed = parseLocalReportNotes(note.discussion);
  const actionItems = note.actionItems?.length ? note.actionItems : parsed.actionItems;

  if (!actionItems.length) {
    window.alert("No action items found. Use -* at the start of a note line to mark an action item.");
    return;
  }

  const content = actionItems.map((item) => `- ${item}`).join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${projectLabel(project)} - ${note.title || "Meeting"} Action Items.txt`.replace(/[<>:"/\\|?*]+/g, " ");
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function downloadBrowserReportPdf(project, note) {
  const content = buildEmailReportText(project, note);
  const blob = new Blob([buildBrowserPdf(content)], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${projectLabel(project)} - ${note.title || "Meeting Report"}.pdf`.replace(/[<>:"/\\|?*]+/g, " ");
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  return true;
}

function buildBrowserPdf(text) {
  const lines = wrapBrowserPdfLines(String(text || ""), 88);
  const pages = [];
  for (let index = 0; index < lines.length; index += 44) {
    pages.push(lines.slice(index, index + 44));
  }
  if (pages.length === 0) pages.push(["No report content."]);

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  pages.forEach((pageLines) => {
    const stream = buildBrowserPdfPageStream(pageLines);
    const contentId = addObject(`<< /Length ${utf8Length(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(utf8Length(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = utf8Length(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function buildBrowserPdfPageStream(lines) {
  return [
    "BT",
    "/F1 11 Tf",
    "50 752 Td",
    "14 TL",
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET",
  ].join("\n");
}

function wrapBrowserPdfLines(text, maxLength) {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [""];
    const words = line.split(/\s+/);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLength) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines;
  });
}

function escapePdfText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}

function buildEmailReportText(project, note) {
  const parsed = parseLocalReportNotes(note.discussion);
  const decisions = note.decisionItems?.length ? note.decisionItems : parsed.clientDecisions;
  const notes = parsed.notes;
  const completed = note.completedActionItems || [];

  return [
    projectLabel(project),
    note.date || "No date listed",
    "",
    "Action Items",
    formatEmailChecklist(note.actionItems || [], completed),
    "",
    "Decisions",
    formatEmailList(decisions),
    "",
    "Notes",
    formatEmailList(notes),
  ].join("\n");
}

function formatEmailChecklist(items, completed) {
  return items.length ? items.map((item) => `${completed.includes(item) ? "[x]" : "[ ]"} ${item}`).join("\n") : "None noted";
}

function formatEmailList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "None noted";
}

function parseLocalReportNotes(discussion) {
  const actionItems = [];
  const clientDecisions = [];
  const notes = [];

  String(discussion || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (isClientDecisionLine(line)) {
        clientDecisions.push(cleanLocalMarkedLine(line.replace(/^-?\s*\*\*/, "")));
      } else if (isActionItemLine(line)) {
        actionItems.push(cleanLocalMarkedLine(line.replace(/^-?\s*\*/, "")));
      } else {
        notes.push(cleanLocalMarkedLine(line));
      }
    });

  return {
    actionItems: actionItems.filter(Boolean),
    clientDecisions: clientDecisions.filter(Boolean),
    notes: notes.filter(Boolean),
  };
}

function cleanLocalMarkedLine(value) {
  return String(value || "").replace(/^[-*\u2022\d.)\s]+/, "").trim();
}

function buildLocalReport(project, note, parsed) {
  return [
    `${projectLabel(project)}`,
    "",
    `Date: ${note.date || "Not listed"}`,
    `Meeting Type: ${note.meetingType || "Not listed"}`,
    `Attendees: ${note.attendees || "Not listed"}`,
    "",
    "Action Items",
    formatLocalList(parsed.actionItems),
    "",
    "Decisions",
    formatLocalList(parsed.clientDecisions),
    "",
    "Notes",
    formatLocalList(parsed.notes),
  ].join("\n");
}

function formatLocalList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None noted";
}

function updateActiveNote(field, value) {
  const note = activeNote();
  if (!note) return;

  note[field] = value;
  note.updatedAt = new Date().toISOString();

  if (field === "title") {
    els.noteHeader.textContent = value || "Meeting Notes";
  }

  renderProjects();
  renderProjectTabs();
  renderTimeline();
  scheduleSave();
}

function updateMeetingType(type, checked) {
  updateActiveNote("meetingType", checked ? type : "");
  renderEditor();
}

function getDiscussionText() {
  const lines = [...els.noteDiscussion.querySelectorAll(".discussion-line")].map((line) => line.textContent);
  return lines.length ? lines.join("\n") : els.noteDiscussion.textContent;
}

function renderDiscussionEditor(text, caretOffset = null) {
  state.isRenderingDiscussion = true;
  const lines = String(text || "").split(/\r?\n/);
  els.noteDiscussion.innerHTML = lines.map((line) => {
    const isIndented = /^\s+/.test(line);
    const content = line ? escapeHtml(line) : "<br>";
    return `<div class="discussion-line${isIndented ? " indented" : " top-level"}">${content}</div>`;
  }).join("");
  if (!lines.length) {
    els.noteDiscussion.innerHTML = `<div class="discussion-line top-level"><br></div>`;
  }
  if (caretOffset !== null) {
    setDiscussionCaret(caretOffset);
  }
  state.isRenderingDiscussion = false;
}

function getDiscussionCaret() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return 0;
  if (!els.noteDiscussion.contains(selection.anchorNode)) return getDiscussionText().length;

  const position = getDiscussionLinePosition();
  if (position) {
    return getOffsetFromLinePosition(position.lineIndex, position.offsetInLine);
  }

  const range = selection.getRangeAt(0);
  const clone = range.cloneRange();
  clone.selectNodeContents(els.noteDiscussion);
  clone.setEnd(range.endContainer, range.endOffset);
  return clone.toString().length;
}

function getDiscussionLinePosition() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const line = getDiscussionLineFromNode(range.endContainer);
  if (!line) return null;

  const lines = [...els.noteDiscussion.querySelectorAll(".discussion-line")];
  const lineIndex = lines.indexOf(line);
  if (lineIndex === -1) return null;

  const lineRange = document.createRange();
  lineRange.selectNodeContents(line);
  lineRange.setEnd(range.endContainer, range.endOffset);

  return {
    lineIndex,
    offsetInLine: lineRange.toString().length,
  };
}

function getDiscussionLineFromNode(node) {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest?.(".discussion-line") || null;
}

function getOffsetFromLinePosition(lineIndex, offsetInLine) {
  const lines = [...els.noteDiscussion.querySelectorAll(".discussion-line")];
  return lines.slice(0, lineIndex).reduce((offset, line) => offset + line.textContent.length + 1, 0) + offsetInLine;
}

function setDiscussionCaret(offset) {
  const lines = [...els.noteDiscussion.querySelectorAll(".discussion-line")];
  let remaining = Math.max(0, offset);

  for (const line of lines) {
    const textNode = [...line.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const length = textNode?.textContent.length || 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(textNode || line, textNode ? remaining : 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length + 1;
  }

  const range = document.createRange();
  range.selectNodeContents(els.noteDiscussion);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceDiscussionText(start, end, insert) {
  const value = getDiscussionText();
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  renderDiscussionEditor(next, start + insert.length);
  updateActiveNote("discussion", next);
}

function pushDiscussionUndo() {
  const value = getDiscussionText();
  if (state.discussionUndoStack[state.discussionUndoStack.length - 1] !== value) {
    state.discussionUndoStack.push(value);
  }
  if (state.discussionUndoStack.length > 100) {
    state.discussionUndoStack.shift();
  }
}

function undoDiscussionEdit() {
  const previous = state.discussionUndoStack.pop();
  if (previous === undefined) return;
  renderDiscussionEditor(previous, previous.length);
  updateActiveNote("discussion", previous);
}

function setBulletCaret(textarea) {
  const value = getDiscussionText();
  if (value.trim()) return;
  renderDiscussionEditor("- ", 2);
  updateActiveNote("discussion", "- ");
}

function handleBulletKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoDiscussionEdit();
    return;
  }

  if (event.key === "Tab") {
    handleBulletIndent(event);
    return;
  }

  if (event.key !== "Enter") return;

  event.preventDefault();
  pushDiscussionUndo();
  const value = getDiscussionText();
  const start = getDiscussionCaret();
  const end = start;
  const before = value.slice(0, start);
  const currentLine = before.split("\n").pop();
  const indent = currentLine.match(/^\s*/)?.[0] || "";
  const trimmedLine = currentLine.trim();
  const currentMarker = getLineMarker(trimmedLine);
  const insert = ["-", "*", ">"].includes(trimmedLine) ? "\n" : `\n${indent}${currentMarker} `;

  replaceDiscussionText(start, end, insert);
}

function handleBulletIndent(event) {
  event.preventDefault();
  pushDiscussionUndo();
  const position = getDiscussionLinePosition();
  const value = getDiscussionText();
  const start = position ? getOffsetFromLinePosition(position.lineIndex, position.offsetInLine) : getDiscussionCaret();
  const lineStart = position ? getOffsetFromLinePosition(position.lineIndex, 0) : value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", lineStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);

  if (event.shiftKey) {
    const removable = line.startsWith("  ") ? 2 : line.startsWith("\t") ? 1 : 0;
    if (!removable) return;
    const next = `${value.slice(0, lineStart)}${line.slice(removable)}${value.slice(lineEnd)}`;
    const nextStart = Math.max(lineStart, start - removable);
    renderDiscussionEditor(next, nextStart);
    updateActiveNote("discussion", next);
  } else {
    const next = `${value.slice(0, lineStart)}  ${line}${value.slice(lineEnd)}`;
    renderDiscussionEditor(next, start + 2);
    updateActiveNote("discussion", next);
  }
}

function handleBulletPaste(event) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text || !text.includes("\n")) return;

  event.preventDefault();
  pushDiscussionUndo();
  const value = getDiscussionText();
  const start = getDiscussionCaret();
  const end = start;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pasted = toBulletText(text);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !pasted.endsWith("\n") ? "\n" : "";

  const next = `${before}${prefix}${pasted}${suffix}${after}`;
  const nextPosition = before.length + prefix.length + pasted.length;
  renderDiscussionEditor(next, nextPosition);
  updateActiveNote("discussion", next);
}

function handleDiscussionBeforeInput() {
  if (!state.isRenderingDiscussion) {
    pushDiscussionUndo();
  }
}

function handleDiscussionInput() {
  if (state.isRenderingDiscussion) return;
  const caret = getDiscussionCaret();
  const text = getDiscussionText();
  renderDiscussionEditor(text, caret);
  updateActiveNote("discussion", text);
}

function parseDiscussionItems(text) {
  const seen = new Set();
  return String(text || "")
    .split(/\r?\n/)
    .map((line, lineIndex) => ({
      text: line.replace(/^[-*\u2022\d.)\s]+/, "").trim(),
      lineIndex,
    }))
    .filter((item) => {
      if (!item.text || seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });
}

function toBulletText(value) {
  const text = String(value || "").trim();
  if (!text || text === "-") return "- ";

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (isBulletLine(line) ? line : `- ${line}`))
    .join("\n");
}

function isBulletLine(line) {
  return /^(-\*\*|-\*|[-*>]|\d+[.)])\s+/.test(line);
}

function getLineMarker(trimmedLine) {
  if (isClientDecisionLine(trimmedLine)) return "-**";
  if (isActionItemLine(trimmedLine)) return "-*";
  return "-";
}

function isActionItemLine(line) {
  return /^-?\s*\*(?!\*)/.test(line);
}

function isClientDecisionLine(line) {
  return /^-?\s*\*\*/.test(line);
}

function createProject(clientName, projectName) {
  const trimmedClient = clientName.trim();
  const trimmedProject = projectName.trim();
  if (!trimmedClient || !trimmedProject) return false;

  const project = {
    id: uid("project"),
    clientName: trimmedClient,
    projectName: trimmedProject,
    name: `${trimmedClient} / ${trimmedProject}`,
    createdAt: new Date().toISOString(),
    notes: [],
  };
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  ensureProjectHasNote();
  render();
  scheduleSave();
  return true;
}

function removeProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;

  const confirmed = window.confirm(`Remove "${projectLabel(project)}" and all notes in it?`);
  if (!confirmed) return;

  const removedActiveProject = state.activeProjectId === projectId;
  state.projects = state.projects.filter((item) => item.id !== projectId);

  if (removedActiveProject) {
    state.activeProjectId = state.projects[0]?.id || null;
    state.activeNoteId = null;
    ensureProjectHasNote();
  }

  if (state.projects.length === 0) {
    els.searchInput.value = "";
  }

  state.allowDestructiveSave = true;
  render();
  scheduleSave();
}

function createNote() {
  const project = activeProject();
  if (!project) return;

  const note = newNote();
  project.notes.unshift(note);
  state.activeNoteId = note.id;
  render();
  scheduleSave();
}

async function handleAttendeePaste(event) {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;

  event.preventDefault();
  const file = imageItem.getAsFile();
  const src = await readFileAsDataUrl(file);
  updateActiveNote("attendeeImage", src);
  renderAttendeeImage(src);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function askNotes() {
  const question = els.questionInput.value.trim();
  const project = activeProject();
  if (!question || !project) return;

  if (window.location.protocol === "file:") {
    els.answerBox.textContent = buildLocalQuestionAnswer(project, question);
    return;
  }

  els.answerBox.textContent = "Reading your notes...";
  els.askButton.disabled = true;

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        projectId: project.id,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI search is not available yet.");
    }

    els.answerBox.textContent = data.answer;
  } catch (error) {
    els.answerBox.textContent = buildLocalQuestionAnswer(project, question);
  } finally {
    els.askButton.disabled = false;
  }
}

function buildLocalQuestionAnswer(project, question) {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);

  const matches = (project.notes || [])
    .map((note) => {
      const text = getNoteSearchText(note);
      const score = terms.reduce((count, term) => count + (text.toLowerCase().includes(term) ? 1 : 0), 0);
      return { note, score, text };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (!matches.length) {
    return "AI answers are not connected in this version of the app.\n\nI did not find matching notes in this project yet.";
  }

  return [
    "AI answers are not connected in this version of the app.",
    "",
    "Best matches from this project:",
    ...matches.map(({ note }) => {
      const preview = String(note.discussion || note.finalReport || "No note details yet.").replace(/\s+/g, " ").trim();
      return `- ${note.date || "No date"} - ${note.title || "Untitled meeting"}: ${preview.slice(0, 220)}${preview.length > 220 ? "..." : ""}`;
    }),
  ].join("\n");
}

async function archiveNotes() {
  els.archiveNotesButton.disabled = true;
  const originalLabel = els.archiveNotesButton.textContent;
  els.archiveNotesButton.textContent = "Archiving...";

  try {
    if (state.isDirty) {
      await saveData();
    }

    const response = await fetch("/api/archive", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not archive notes.");
    }

    els.saveStatus.textContent = `Archived ${data.noteCount} notes`;
    window.alert(`Archived ${data.noteCount} notes into:\n${data.archiveDir}`);
  } catch (error) {
    downloadLocalArchive();
    window.alert("The server is not running, so I downloaded one archive file instead. Start the server to archive into project folders automatically.");
  } finally {
    els.archiveNotesButton.disabled = false;
    els.archiveNotesButton.textContent = originalLabel;
  }
}

function downloadLocalArchive() {
  const content = state.projects.map(formatLocalArchiveProject).join("\n\n---\n\n");
  const blob = new Blob([content || "No notes to archive."], { type: "text/markdown" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `TC Notes Archive ${today()}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function formatLocalArchiveProject(project) {
  return [
    `# ${projectLabel(project)}`,
    "",
    ...(project.notes || []).map((note) => [
      `## ${note.title || "Untitled meeting"}`,
      "",
      `Date: ${note.date || "Not listed"}`,
      `Attendees: ${note.attendees || "Not listed"}`,
      "",
      "### Final Report",
      note.finalReport || "No final report created yet.",
      "",
      "### Discussion Notes",
      note.discussion || "No discussion notes.",
    ].join("\n")),
  ].join("\n");
}

function getNoteSearchText(note) {
  return [
    note.title,
    note.date,
    note.meetingType,
    note.attendees,
    note.discussion,
    note.finalReport,
    ...(note.actionItems || []),
    ...(note.decisionItems || []),
  ].join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.newProjectButton.addEventListener("click", () => {
  els.clientNameInput.value = "";
  els.projectNameInput.value = "";
  els.projectDialog.showModal();
  setTimeout(() => els.clientNameInput.focus(), 0);
});
els.archiveNotesButton.addEventListener("click", archiveNotes);

els.cancelProjectButton.addEventListener("click", () => {
  els.projectDialog.close();
});

els.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (createProject(els.clientNameInput.value, els.projectNameInput.value)) {
    els.projectDialog.close();
  }
});

els.themeToggleButton.addEventListener("click", toggleTheme);
els.newNoteButton.addEventListener("click", createNote);
els.noteTitle.addEventListener("input", (event) => updateActiveNote("title", event.target.value));
els.noteDate.addEventListener("input", (event) => updateActiveNote("date", event.target.value));
els.meetingInPerson.addEventListener("change", (event) => updateMeetingType("In-Person", event.target.checked));
els.meetingVirtual.addEventListener("change", (event) => updateMeetingType("Virtual", event.target.checked));
els.noteAttendees.addEventListener("input", (event) => updateActiveNote("attendees", event.target.value));
els.noteAttendees.addEventListener("paste", handleAttendeePaste);
els.attendeePasteZone.addEventListener("paste", handleAttendeePaste);
els.removeAttendeeImageButton.addEventListener("click", () => {
  updateActiveNote("attendeeImage", "");
  renderAttendeeImage("");
});
els.noteDiscussion.dataset.field = "discussion";
els.noteDiscussion.addEventListener("focus", () => setBulletCaret(els.noteDiscussion));
els.noteDiscussion.addEventListener("beforeinput", handleDiscussionBeforeInput);
els.noteDiscussion.addEventListener("keydown", handleBulletKeydown);
els.noteDiscussion.addEventListener("paste", handleBulletPaste);
els.noteDiscussion.addEventListener("input", handleDiscussionInput);
els.searchInput.addEventListener("input", renderTimeline);
els.askButton.addEventListener("click", askNotes);
els.createReportButton.addEventListener("click", createFinalReport);
els.emailReportButton.addEventListener("click", emailFinalReport);
els.downloadReportButton.addEventListener("click", downloadFinalReport);
els.downloadActionItemsButton.addEventListener("click", downloadActionItems);
window.addEventListener("beforeunload", saveBeforeUnload);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveBeforeUnload();
  }
});

applySavedTheme();
loadData().catch((error) => {
  els.answerBox.textContent = `The dashboard could not load notes: ${error.message}`;
});
