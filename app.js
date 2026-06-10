const state = {
  employees: [],
  activeEmployeeId: null,
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

const localBackupKey = "tc-notes-backup-v1";
const activeSelectionKey = "ma-notes-active-selection";

const els = {
  employeeSelect: document.getElementById("employeeSelect"),
  editEmployeeButton: document.getElementById("editEmployeeButton"),
  newEmployeeButton: document.getElementById("newEmployeeButton"),
  employeeDialog: document.getElementById("employeeDialog"),
  employeeForm: document.getElementById("employeeForm"),
  cancelEmployeeButton: document.getElementById("cancelEmployeeButton"),
  employeeNameInput: document.getElementById("employeeNameInput"),
  projectList: document.getElementById("projectList"),
  projectTabs: document.getElementById("projectTabs"),
  newProjectButton: document.getElementById("newProjectButton"),
  archiveNotesButton: document.getElementById("archiveNotesButton"),
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
  handwritingDropZone: document.getElementById("handwritingDropZone"),
  handwrittenNotesInput: document.getElementById("handwrittenNotesInput"),
  handwritingStatus: document.getElementById("handwritingStatus"),
  noteDiscussion: document.getElementById("noteDiscussion"),
  meetingToolbar: document.querySelector(".meeting-toolbar"),
  formatButtons: [...document.querySelectorAll("[data-format-command]")],
  fontSizeButtons: [...document.querySelectorAll("[data-font-size]")],
  autoCorrectButton: document.getElementById("autoCorrectButton"),
  screenshotPasteZone: document.getElementById("screenshotPasteZone"),
  screenshotGallery: document.getElementById("screenshotGallery"),
  screenshotDialog: document.getElementById("screenshotDialog"),
  screenshotDialogImage: document.getElementById("screenshotDialogImage"),
  closeScreenshotDialog: document.getElementById("closeScreenshotDialog"),
  createReportButton: document.getElementById("createReportButton"),
  emailReportButton: document.getElementById("emailReportButton"),
  downloadReportButton: document.getElementById("downloadReportButton"),
  downloadActionItemsButton: document.getElementById("downloadActionItemsButton"),
  finalReport: document.getElementById("finalReport"),
  searchInput: document.getElementById("searchInput"),
  searchScope: document.getElementById("searchScope"),
  questionInput: document.getElementById("questionInput"),
  askButton: document.getElementById("askButton"),
  answerBox: document.getElementById("answerBox"),
  notesTimeline: document.getElementById("notesTimeline"),
  noteCount: document.getElementById("noteCount"),
  projectHistoryTitle: document.getElementById("projectHistoryTitle"),
};

let savedDiscussionSelection = null;

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function activeProject() {
  return activeProjects().find((project) => project.id === state.activeProjectId);
}

function activeNote() {
  return activeProject()?.notes.find((note) => note.id === state.activeNoteId);
}

function activeEmployee() {
  return state.employees.find((employee) => employee.id === state.activeEmployeeId);
}

function activeProjects() {
  return activeEmployee()?.projects || [];
}

function allProjectsWithEmployees() {
  return state.employees.flatMap((employee) =>
    (employee.projects || []).map((project) => ({
      employee,
      project,
    }))
  );
}

function newEmployee(name = "Employee") {
  return {
    id: uid("employee"),
    name: String(name || "Employee").trim() || "Employee",
    createdAt: new Date().toISOString(),
    projects: [],
  };
}

function newProject(clientName = "", projectName = "") {
  return {
    id: uid("project"),
    clientName: String(clientName || "").trim(),
    projectName: String(projectName || "").trim() || "Untitled project",
    createdAt: new Date().toISOString(),
    notes: [],
  };
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
    screenshots: [],
    discussion: "",
    discussionHtml: "",
    discussionFontSize: 16,
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
  const serverEmployees = normalizeEmployeesFromData(data);
  const localBackup = readLocalBackup();
  const usedLocalBackup = shouldUseLocalBackup(localBackup, serverEmployees);

  state.employees = usedLocalBackup ? localBackup.employees : serverEmployees;

  if (state.employees.length === 0) {
    state.employees = [newEmployee("My Notes")];
  }

  if (activeProjects().length === 0 && state.employees[0].projects.length === 0) {
    state.employees[0].projects = [newProject("General", "Notes")];
    await saveData(true);
  }

  persistLocalBackup();
  restoreActiveSelection();
  ensureEmployeeHasProject();
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
      employees: normalizeEmployeesFromData(backup),
    };
  } catch (error) {
    return { savedAt: "", employees: [] };
  }
}

function persistLocalBackup() {
  try {
    localStorage.setItem(
      localBackupKey,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        employees: state.employees,
      })
    );
  } catch (error) {
    // The normal file save still runs if browser storage is unavailable.
  }
}

function persistActiveSelection() {
  try {
    localStorage.setItem(
      activeSelectionKey,
      JSON.stringify({
        employeeId: state.activeEmployeeId,
        projectId: state.activeProjectId,
        noteId: state.activeNoteId,
      })
    );
  } catch (error) {
    // Selection restore is a convenience; notes still save normally.
  }
}

function restoreActiveSelection() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(activeSelectionKey) || "{}");
  } catch (error) {
    saved = {};
  }

  const employee = state.employees.find((item) => item.id === saved.employeeId) || state.employees[0];
  state.activeEmployeeId = employee?.id || null;

  const projects = activeProjects();
  const project = projects.find((item) => item.id === saved.projectId) || projects[0];
  state.activeProjectId = project?.id || null;

  const note = project?.notes?.find((item) => item.id === saved.noteId) || project?.notes?.[0];
  state.activeNoteId = note?.id || null;
}

function shouldUseLocalBackup(localBackup, serverEmployees) {
  const localEmployees = localBackup.employees || [];
  const localStats = getEmployeeStats(localEmployees);
  const serverStats = getEmployeeStats(serverEmployees);

  if (!localEmployees.length) return false;
  if (!serverEmployees.length) return localStats.meaningfulTextLength > 20;

  const localHasMoreProjects = localStats.projectCount > serverStats.projectCount;
  const localHasMoreNotes = localStats.noteCount > serverStats.noteCount;
  const localHasAtLeastSameShape = localStats.projectCount >= serverStats.projectCount && localStats.noteCount >= serverStats.noteCount;
  const localHasMoreContent = localStats.meaningfulTextLength > serverStats.meaningfulTextLength + 20;
  const serverLooksBlank = serverStats.meaningfulTextLength < 20;

  return localHasMoreProjects || localHasMoreNotes || (localHasAtLeastSameShape && localHasMoreContent && serverLooksBlank);
}

function normalizeEmployeesFromData(data) {
  if (Array.isArray(data.employees)) {
    return data.employees.map(normalizeEmployee);
  }

  const projects = Array.isArray(data.projects) ? data.projects.map(normalizeProject) : [];
  return projects.length
    ? [
        {
          id: uid("employee"),
          name: "My Notes",
          createdAt: new Date().toISOString(),
          projects,
        },
      ]
    : [];
}

function normalizeEmployee(employee) {
  return {
    id: String(employee.id || uid("employee")),
    name: String(employee.name || "Employee"),
    createdAt: String(employee.createdAt || new Date().toISOString()),
    projects: (employee.projects || []).map(normalizeProject),
  };
}

function getEmployeeStats(employees) {
  return getProjectStats(employees.flatMap((employee) => employee.projects || []));
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
    discussion: String(note.discussion || note.body || ""),
    actionItems,
    completedActionItems,
    decisionItems,
    finalReport: note.finalReport || "",
    meetingType: note.meetingType || "",
    attendeeImage: note.attendeeImage || "",
    screenshots: Array.isArray(note.screenshots) ? note.screenshots : [],
    discussionHtml: note.discussionHtml || "",
    discussionFontSize: Number(note.discussionFontSize) || 16,
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
        employees: state.employees,
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
  if (!state.employees.length || !state.isDirty) return;

  persistLocalBackup();
  clearTimeout(state.saveTimer);

  const payload = JSON.stringify({
    employees: state.employees,
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
  persistActiveSelection();
  renderEmployees();
  renderProjects();
  renderProjectTabs();
  renderSearchScope();
  renderEditor();
  renderTimeline();
}

function renderSearchScope() {
  const previousValue = els.searchScope.value || "all";
  els.searchScope.innerHTML = `<option value="all">All employees and projects</option>`;

  allProjectsWithEmployees().forEach(({ employee, project }) => {
    const option = document.createElement("option");
    option.value = `project:${project.id}`;
    option.textContent = `${employee.name} / ${projectLabel(project)}`;
    els.searchScope.appendChild(option);
  });

  els.searchScope.value = [...els.searchScope.options].some((option) => option.value === previousValue) ? previousValue : "all";
}

function setActiveEmployee(employeeId) {
  state.activeEmployeeId = employeeId;
  const projects = activeProjects();
  state.activeProjectId = projects[0]?.id || null;
  state.activeNoteId = null;
  els.searchInput.value = "";
  ensureEmployeeHasProject();
  ensureProjectHasNote();
  persistActiveSelection();
  render();
}

function setActiveProject(projectId) {
  state.activeProjectId = projectId;
  els.searchInput.value = "";
  ensureProjectHasNote();
  persistActiveSelection();
  render();
}

function ensureEmployeeHasProject() {
  const employee = activeEmployee();
  if (!employee) return;
  employee.projects = Array.isArray(employee.projects) ? employee.projects : [];
  if (!employee.projects.length) {
    const project = newProject("General", "Notes");
    employee.projects.unshift(project);
    state.activeProjectId = project.id;
    scheduleSave();
  }
}

function renderEmployees() {
  els.employeeSelect.innerHTML = "";

  state.employees.forEach((employee) => {
    const option = document.createElement("option");
    option.value = employee.id;
    option.textContent = employee.name;
    els.employeeSelect.appendChild(option);
  });

  els.employeeSelect.value = state.activeEmployeeId || "";
  els.editEmployeeButton.disabled = !activeEmployee();
}

function renderProjects() {
  els.projectList.innerHTML = "";

  activeProjects().forEach((project) => {
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

  activeProjects().forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-tab${project.id === state.activeProjectId ? " active" : ""}`;
    button.textContent = projectLabel(project);
    button.addEventListener("click", () => setActiveProject(project.id));
    els.projectTabs.appendChild(button);
  });
}

function renderEditor() {
  const employee = activeEmployee();
  const project = activeProject();
  const note = activeNote();
  const label = project ? projectLabel(project) : "Select a project";

  els.projectTitle.textContent = employee ? `${employee.name} - ${label}` : label;
  els.projectHistoryTitle.textContent = project ? `All Notes For ${employee?.name || "Employee"} / ${label}` : "All Notes For This Project";
  els.noteHeader.textContent = note?.title || "MA Notes";
  els.noteTitle.value = note?.title || "";
  els.noteDate.value = note?.date || today();
  els.meetingInPerson.checked = note?.meetingType === "In-Person";
  els.meetingVirtual.checked = note?.meetingType === "Virtual";
  els.noteAttendees.value = note?.attendees || "";
  renderDiscussionEditor(note?.discussion || "", null, note?.discussionHtml || "");
  applyDiscussionFontSize(note?.discussionFontSize || 16);
  state.discussionUndoStack = [];
  renderFinalReport(note);
  renderAttendeeImage(note?.attendeeImage || "");
  renderScreenshots(note?.screenshots || []);

  const hasProject = Boolean(project);
  [els.newNoteButton, els.noteTitle, els.noteDate, els.meetingInPerson, els.meetingVirtual, els.noteAttendees, els.askButton, els.createReportButton, els.emailReportButton, els.downloadReportButton, els.downloadActionItemsButton].forEach((el) => {
    el.disabled = !hasProject;
  });
  els.noteDiscussion.setAttribute("contenteditable", hasProject ? "true" : "false");
  els.formatButtons.forEach((button) => {
    button.disabled = !hasProject;
  });
  els.fontSizeButtons.forEach((button) => {
    button.disabled = !hasProject;
  });
  els.autoCorrectButton.disabled = !hasProject;
}

function renderAttendeeImage(src) {
  els.attendeeImagePreview.src = src;
  els.attendeePasteZone.classList.toggle("has-image", Boolean(src));
}

function renderScreenshots(screenshots = []) {
  els.screenshotGallery.innerHTML = "";
  els.screenshotPasteZone.classList.toggle("has-screenshots", screenshots.length > 0);

  screenshots.forEach((src, index) => {
    const item = document.createElement("figure");
    item.className = "screenshot-item";
    item.innerHTML = `
      <img src="${escapeHtml(src)}" alt="Pasted screenshot ${index + 1}" />
      <button class="secondary-button" type="button">Remove</button>
    `;
    item.querySelector("img").addEventListener("click", (event) => {
      event.stopPropagation();
      openScreenshot(src);
    });
    item.querySelector("button").addEventListener("click", (event) => {
      event.stopPropagation();
      removeScreenshot(index);
    });
    els.screenshotGallery.appendChild(item);
  });
}

function openScreenshot(src) {
  els.screenshotDialogImage.src = src;
  els.screenshotDialog.showModal();
}

function closeScreenshot() {
  els.screenshotDialog.close();
  els.screenshotDialogImage.src = "";
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
      persistActiveSelection();
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
    const indentSize = getReportItemIndent(value).replace(/\t/g, "  ").length;
    item.textContent = String(value || "").trim();
    if (indentSize) {
      item.style.marginLeft = `${Math.min(indentSize * 12, 72)}px`;
    }
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
    window.alert("No action items found. Use * at the start of a note line to mark an action item.");
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
  return items.length ? items.map((item) => `${getReportItemIndent(item)}- ${String(item).trim()}`).join("\n") : "None noted";
}

function parseLocalReportNotes(discussion) {
  const actionItems = [];
  const clientDecisions = [];
  const notes = [];

  String(discussion || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .forEach((line) => {
      const trimmedLine = line.trim();
      if (isClientDecisionLine(trimmedLine)) {
        clientDecisions.push(cleanLocalMarkedLine(trimmedLine.replace(/^-?\s*\*\*/, "")));
      } else if (isActionItemLine(trimmedLine)) {
        actionItems.push(cleanLocalMarkedLine(trimmedLine.replace(/^-?\s*\*/, "")));
      } else {
        notes.push(cleanLocalNoteLine(line));
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

function cleanLocalNoteLine(value) {
  const line = String(value || "");
  const indent = line.match(/^\s*/)?.[0] || "";
  const text = line.slice(indent.length).replace(/^[-\u2022\d.)]+\s*/, "").trim();
  return text ? `${indent}${text}` : "";
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
  return items.length ? items.map((item) => `${getReportItemIndent(item)}- ${String(item).trim()}`).join("\n") : "- None noted";
}

function getReportItemIndent(item) {
  return String(item || "").match(/^\s*/)?.[0] || "";
}

function updateActiveNote(field, value) {
  const note = activeNote();
  if (!note) return;

  note[field] = value;
  note.updatedAt = new Date().toISOString();

  if (field === "title") {
    els.noteHeader.textContent = value || "MA Notes";
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
  const lines = getDiscussionLineElements().map((line) => line.textContent);
  return lines.length ? lines.join("\n") : els.noteDiscussion.textContent;
}

function getDiscussionLineElements() {
  const discussionLines = [...els.noteDiscussion.querySelectorAll(".discussion-line")];
  if (discussionLines.length) return discussionLines;

  return [...els.noteDiscussion.children].filter((child) => ["DIV", "P"].includes(child.tagName));
}

function renderDiscussionEditor(text, caretOffset = null, html = "") {
  state.isRenderingDiscussion = true;
  if (html) {
    els.noteDiscussion.innerHTML = sanitizeDiscussionHtml(html);
    if (!els.noteDiscussion.querySelector(".discussion-line")) {
      const restoredText = getDiscussionText();
      renderDiscussionEditor(restoredText || text, caretOffset);
      return;
    }
    if (caretOffset !== null) {
      setDiscussionCaret(caretOffset);
    }
    state.isRenderingDiscussion = false;
    return;
  }

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

function sanitizeDiscussionHtml(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html || "");
  wrapper.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());

  [...wrapper.querySelectorAll("*")].forEach((node) => {
    const allowedTags = ["DIV", "BR", "B", "STRONG", "I", "EM", "U", "SPAN"];
    if (!allowedTags.includes(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    [...node.attributes].forEach((attribute) => {
      if (attribute.name !== "class") node.removeAttribute(attribute.name);
    });

    if (node.className && !String(node.className).split(/\s+/).every((name) => ["discussion-line", "top-level", "indented"].includes(name))) {
      node.removeAttribute("class");
    }
  });

  return wrapper.innerHTML;
}

function saveDiscussionFromEditor() {
  const note = activeNote();
  if (!note) return;

  note.discussion = getDiscussionText();
  note.discussionHtml = sanitizeDiscussionHtml(els.noteDiscussion.innerHTML);
  note.updatedAt = new Date().toISOString();

  renderProjects();
  renderProjectTabs();
  renderTimeline();
  scheduleSave();
}

function applyDiscussionFontSize(size) {
  const normalized = Math.min(22, Math.max(14, Number(size) || 16));
  els.noteDiscussion.style.fontSize = `${normalized}px`;
  els.noteDiscussion.style.lineHeight = "1.55";
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
    const textNodes = getTextNodes(line);
    const length = line.textContent.length || 0;
    if (remaining <= length) {
      const target = findTextNodeAtOffset(textNodes, remaining);
      const range = document.createRange();
      range.setStart(target.node || line, target.node ? target.offset : 0);
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

function getTextNodes(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

function findTextNodeAtOffset(nodes, offset) {
  let remaining = Math.max(0, offset);
  for (const node of nodes) {
    const length = node.textContent.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.textContent.length } : { node: null, offset: 0 };
}

function saveDiscussionSelection() {
  const selection = window.getSelection();
  if (!selection.rangeCount || !els.noteDiscussion.contains(selection.anchorNode)) return;
  savedDiscussionSelection = selection.getRangeAt(0).cloneRange();
}

function restoreDiscussionSelection() {
  if (!savedDiscussionSelection) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedDiscussionSelection);
}

function replaceDiscussionText(start, end, insert) {
  const value = getDiscussionText();
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  renderDiscussionEditor(next, start + insert.length);
  updateActiveNote("discussion", next);
  updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
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
  updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
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

  const value = getDiscussionText();
  const start = getDiscussionCaret();
  const line = getLineAtOffset(value, start);
  const bullet = getBulletMatch(line.text);

  if (!bullet) {
    return;
  }

  event.preventDefault();
  pushDiscussionUndo();

  if (!bullet.body.trim()) {
    const next = `${value.slice(0, line.start)}${value.slice(start)}`;
    renderDiscussionEditor(next, line.start);
    updateActiveNote("discussion", next);
    updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
    return;
  }

  replaceDiscussionText(start, start, `\n${bullet.indent}${getNextBulletMarker(bullet.marker)} `);
}

function getLineAtOffset(value, offset) {
  const start = value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const endIndex = value.indexOf("\n", offset);
  const end = endIndex === -1 ? value.length : endIndex;
  return {
    start,
    end,
    text: value.slice(start, end),
  };
}

function getBulletMatch(line) {
  const match = String(line || "").match(/^(\s*)(-\*\*|-\*|\*\*|\*|[-\u2022>]|\d+[.)])\s+(.*)$/);
  if (!match) return null;
  return {
    indent: match[1] || "",
    marker: match[2],
    body: match[3] || "",
  };
}

function getNextBulletMarker(marker) {
  const numbered = String(marker || "").match(/^(\d+)([.)])$/);
  if (numbered) return `${Number(numbered[1]) + 1}${numbered[2]}`;
  return marker || "-";
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
    updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
  } else {
    const next = `${value.slice(0, lineStart)}  ${line}${value.slice(lineEnd)}`;
    renderDiscussionEditor(next, start + 2);
    updateActiveNote("discussion", next);
    updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
  }
}

function handleBulletPaste(event) {
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain");
  if (!html && (!text || !text.includes("\n"))) return;

  event.preventDefault();
  pushDiscussionUndo();

  if (html) {
    insertDiscussionHtml(normalizePastedNotesHtml(html, text));
    saveDiscussionFromEditor();
    return;
  }

  const value = getDiscussionText();
  const start = getDiscussionCaret();
  const before = value.slice(0, start);
  const after = value.slice(start);
  const pasted = text.trim();
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !pasted.endsWith("\n") ? "\n" : "";
  const next = `${before}${prefix}${pasted}${suffix}${after}`;

  renderDiscussionEditor(next, before.length + prefix.length + pasted.length);
  updateActiveNote("discussion", next);
  updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
}

function insertDiscussionHtml(html) {
  els.noteDiscussion.focus();
  restoreDiscussionSelection();
  document.execCommand("insertHTML", false, html);
}

function normalizePastedNotesHtml(html, fallbackText = "") {
  const source = document.createElement("div");
  source.innerHTML = String(html || "");
  const lines = [];

  function walkBlocks(node, depth = 0) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
          lines.push(makeDiscussionLine(escapeHtml(line), depth));
        });
        return;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName;

      if (tag === "UL" || tag === "OL") {
        [...child.children].forEach((item, index) => {
          if (item.tagName === "LI") {
            const marker = tag === "OL" ? `${index + 1}.` : "•";
            lines.push(makeDiscussionLine(`${marker} ${inlineHtml(item, true)}`, depth));
            [...item.children].filter((nested) => nested.tagName === "UL" || nested.tagName === "OL").forEach((nested) => {
              walkBlocks(nested, depth + 1);
            });
          }
        });
        return;
      }

      if (["H1", "H2", "H3", "H4", "H5", "H6", "P", "DIV"].includes(tag)) {
        const content = inlineHtml(child, true).trim();
        if (content) lines.push(makeDiscussionLine(content, depth));
        [...child.children].filter((nested) => nested.tagName === "UL" || nested.tagName === "OL").forEach((nested) => {
          walkBlocks(nested, depth);
        });
        return;
      }

      walkBlocks(child, depth);
    });
  }

  walkBlocks(source);

  if (!lines.length) {
    lines.push(
      ...String(fallbackText || "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => makeDiscussionLine(escapeHtml(line), 0))
    );
  }

  return sanitizeDiscussionHtml(lines.join(""));
}

function makeDiscussionLine(content, depth = 0) {
  const indent = "  ".repeat(Math.max(0, depth));
  const className = depth > 0 ? "indented" : "top-level";
  return `<div class="discussion-line ${className}">${indent}${content || "<br>"}</div>`;
}

function inlineHtml(node, skipNestedLists = false) {
  return [...node.childNodes].map((child) => {
    if (skipNestedLists && child.nodeType === Node.ELEMENT_NODE && ["UL", "OL"].includes(child.tagName)) {
      return "";
    }

    if (child.nodeType === Node.TEXT_NODE) {
      return escapeHtml(child.textContent.replace(/\s+/g, " "));
    }

    if (child.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = child.tagName;
    const content = inlineHtml(child, skipNestedLists);
    const style = child.getAttribute("style") || "";
    const isBold = ["B", "STRONG"].includes(tag) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style);
    const isItalic = ["I", "EM"].includes(tag) || /font-style\s*:\s*italic/i.test(style);
    const isUnderline = tag === "U" || /text-decoration[^;]*underline/i.test(style);

    let wrapped = content;
    if (isUnderline) wrapped = `<u>${wrapped}</u>`;
    if (isItalic) wrapped = `<em>${wrapped}</em>`;
    if (isBold) wrapped = `<strong>${wrapped}</strong>`;
    return wrapped;
  }).join("");
}

function handleDiscussionBeforeInput() {
  if (!state.isRenderingDiscussion) {
    pushDiscussionUndo();
  }
}

function handleDiscussionInput() {
  if (state.isRenderingDiscussion) return;
  normalizeDiscussionStructure();
  saveDiscussionFromEditor();
}

function normalizeDiscussionStructure() {
  [...els.noteDiscussion.children].forEach((child) => {
    if (!["DIV", "P"].includes(child.tagName)) return;
    child.classList.add("discussion-line");
    if (!child.classList.contains("top-level") && !child.classList.contains("indented")) {
      child.classList.add(/^\s+/.test(child.textContent || "") ? "indented" : "top-level");
    }
  });
}

async function handleHandwrittenNotesUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await processHandwrittenNotesFile(file);
  event.target.value = "";
}

async function processHandwrittenNotesFile(file) {
  const note = activeNote();
  if (!note) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    els.handwritingStatus.textContent = "Drop or upload an image file.";
    return;
  }

  els.handwritingStatus.textContent = "Reading photo with AI...";
  els.handwrittenNotesInput.disabled = true;

  try {
    const imageUrl = await readFileAsDataUrl(file);
    const { text, method } = await recognizeImageText(imageUrl);
    const cleanedText = cleanRecognizedNotes(text);

    if (!cleanedText) {
      els.handwritingStatus.textContent = "No readable text found. Try a brighter, closer photo.";
      return;
    }

    pushDiscussionUndo();
    const currentText = getDiscussionText();
    const textToAdd = toBulletText(cleanedText);
    const nextText = currentText.trim() && currentText.trim() !== "-" ? `${currentText.replace(/\s+$/, "")}\n${textToAdd}` : textToAdd;
    renderDiscussionEditor(nextText, nextText.length);
    updateActiveNote("discussion", nextText);
    els.handwritingStatus.textContent = method === "ai"
      ? "Added AI-read notes to Meeting Notes."
      : "Added OCR text to Meeting Notes. For better handwriting results, run the local server with an OpenAI API key.";
  } catch (error) {
    els.handwritingStatus.textContent = error.message || "Could not read that photo.";
  } finally {
    els.handwrittenNotesInput.disabled = false;
  }
}

async function recognizeImageText(imageUrl) {
  const aiText = await recognizeImageTextWithAi(imageUrl);
  if (aiText) return { text: aiText, method: "ai" };

  throw new Error("AI handwriting reader is not connected. Start the local server and make sure your OpenAI API key is set up before uploading handwritten notes.");
}

async function recognizeImageTextWithAi(imageUrl) {
  const endpoints = window.location.protocol === "file:"
    ? ["http://localhost:4500/api/transcribe-notes"]
    : ["/api/transcribe-notes", "http://localhost:4500/api/transcribe-notes"];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.text) return data.text;
      if (!response.ok && data.error) {
        throw new Error(data.error);
      }
    } catch (error) {
      if (error.message && !error.message.includes("Failed to fetch")) {
        throw error;
      }
      // Try the next endpoint.
    }
  }

  return "";
}

function cleanRecognizedNotes(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function handleHandwritingDragOver(event) {
  event.preventDefault();
  els.handwritingDropZone.classList.add("dragging");
}

function handleHandwritingDragLeave(event) {
  if (!els.handwritingDropZone.contains(event.relatedTarget)) {
    els.handwritingDropZone.classList.remove("dragging");
  }
}

async function handleHandwritingDrop(event) {
  event.preventDefault();
  els.handwritingDropZone.classList.remove("dragging");
  const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));
  if (!file) {
    els.handwritingStatus.textContent = "Drop an image file to read handwritten notes.";
    return;
  }
  await processHandwrittenNotesFile(file);
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
  return /^(-\*\*|-\*|\*\*|\*|[-\u2022>]|\d+[.)])\s+/.test(line);
}

function getLineMarker(trimmedLine) {
  if (isClientDecisionLine(trimmedLine)) return "**";
  if (isActionItemLine(trimmedLine)) return "*";
  return "-";
}

function isActionItemLine(line) {
  return /^-?\s*\*(?!\*)\s*/.test(line);
}

function isClientDecisionLine(line) {
  return /^-?\s*\*\*\s*/.test(line);
}

function createProject(clientName, projectName) {
  const employee = activeEmployee();
  const trimmedClient = clientName.trim();
  const trimmedProject = projectName.trim();
  if (!employee || !trimmedClient || !trimmedProject) return false;

  const project = newProject(trimmedClient, trimmedProject);
  employee.projects.unshift(project);
  state.activeProjectId = project.id;
  ensureProjectHasNote();
  render();
  scheduleSave();
  return true;
}

function removeProject(projectId) {
  const employee = activeEmployee();
  if (!employee) return;

  const project = employee.projects.find((item) => item.id === projectId);
  if (!project) return;

  const confirmed = window.confirm(`Remove "${projectLabel(project)}" and all notes in it?`);
  if (!confirmed) return;

  const removedActiveProject = state.activeProjectId === projectId;
  employee.projects = employee.projects.filter((item) => item.id !== projectId);

  if (removedActiveProject) {
    state.activeProjectId = employee.projects[0]?.id || null;
    state.activeNoteId = null;
    ensureEmployeeHasProject();
    ensureProjectHasNote();
  }

  if (employee.projects.length === 0) {
    els.searchInput.value = "";
  }

  state.allowDestructiveSave = true;
  render();
  scheduleSave();
}

function createEmployee(name) {
  const trimmedName = name.trim();
  if (!trimmedName) return false;

  const employee = newEmployee(trimmedName);
  employee.projects.unshift(newProject("General", "Notes"));
  state.employees.unshift(employee);
  state.activeEmployeeId = employee.id;
  state.activeProjectId = employee.projects[0].id;
  ensureProjectHasNote();
  render();
  scheduleSave();
  return true;
}

function removeEmployee(employeeId) {
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) return;

  if (state.employees.length === 1) {
    window.alert("Keep at least one employee workspace.");
    return;
  }

  const confirmed = window.confirm(`Remove "${employee.name}" and all projects and notes in that employee workspace?`);
  if (!confirmed) return;

  const removedActiveEmployee = state.activeEmployeeId === employeeId;
  state.employees = state.employees.filter((item) => item.id !== employeeId);

  if (removedActiveEmployee) {
    state.activeEmployeeId = state.employees[0]?.id || null;
    state.activeProjectId = activeProjects()[0]?.id || null;
    state.activeNoteId = null;
    ensureEmployeeHasProject();
    ensureProjectHasNote();
  }

  state.allowDestructiveSave = true;
  render();
  scheduleSave();
}

function renameActiveEmployee() {
  const employee = activeEmployee();
  if (!employee) return;

  const nextName = window.prompt("Edit employee name", employee.name);
  if (nextName === null) return;

  const trimmedName = nextName.trim();
  if (!trimmedName) {
    window.alert("Employee name cannot be blank.");
    return;
  }

  employee.name = trimmedName;
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

async function handleScreenshotPaste(event) {
  const note = activeNote();
  if (!note) return;

  const items = [...(event.clipboardData?.items || [])];
  const imageItems = items.filter((item) => item.type.startsWith("image/"));
  if (!imageItems.length) return;

  event.preventDefault();
  const images = await Promise.all(imageItems.map((item) => readFileAsDataUrl(item.getAsFile())));
  const screenshots = [...(note.screenshots || []), ...images];
  updateActiveNote("screenshots", screenshots);
  renderScreenshots(screenshots);
}

function removeScreenshot(index) {
  const note = activeNote();
  if (!note) return;

  const screenshots = [...(note.screenshots || [])];
  screenshots.splice(index, 1);
  updateActiveNote("screenshots", screenshots);
  renderScreenshots(screenshots);
}

function runDiscussionCommand(command) {
  if (!activeNote()) return;

  els.noteDiscussion.focus();
  restoreDiscussionSelection();

  if (command === "bullet") {
    applyBulletToCurrentLine();
    return;
  }

  if (command === "indent" || command === "outdent") {
    handleToolbarIndent(command === "outdent");
    return;
  }

  pushDiscussionUndo();
  document.execCommand(command, false, null);
  saveDiscussionFromEditor();
}

function applyBulletToCurrentLine() {
  const position = getDiscussionLinePosition();
  if (!position) return;

  pushDiscussionUndo();
  const value = getDiscussionText();
  const start = getOffsetFromLinePosition(position.lineIndex, position.offsetInLine);
  const lineStart = getOffsetFromLinePosition(position.lineIndex, 0);
  const lineEndIndex = value.indexOf("\n", lineStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const indent = line.match(/^\s*/)?.[0] || "";
  const body = line.slice(indent.length).replace(/^(-\*\*|-\*|\*\*|\*|[-\u2022>]|\d+[.)])\s*/, "");
  const nextLine = `${indent}- ${body}`;
  const next = `${value.slice(0, lineStart)}${nextLine}${value.slice(lineEnd)}`;
  const nextCaret = Math.max(lineStart + 2, start + (nextLine.length - line.length));

  renderDiscussionEditor(next, nextCaret);
  updateActiveNote("discussion", next);
  updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
}

function handleToolbarIndent(outdent = false) {
  const position = getDiscussionLinePosition();
  if (!position) return;

  pushDiscussionUndo();
  const value = getDiscussionText();
  const start = getOffsetFromLinePosition(position.lineIndex, position.offsetInLine);
  const lineStart = getOffsetFromLinePosition(position.lineIndex, 0);
  const lineEndIndex = value.indexOf("\n", lineStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);

  if (outdent) {
    const removable = line.startsWith("  ") ? 2 : line.startsWith("\t") ? 1 : 0;
    if (!removable) return;
    const next = `${value.slice(0, lineStart)}${line.slice(removable)}${value.slice(lineEnd)}`;
    renderDiscussionEditor(next, Math.max(lineStart, start - removable));
    updateActiveNote("discussion", next);
    updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
    return;
  }

  const next = `${value.slice(0, lineStart)}  ${line}${value.slice(lineEnd)}`;
  renderDiscussionEditor(next, start + 2);
  updateActiveNote("discussion", next);
  updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));
}

function adjustDiscussionFontSize(direction) {
  const note = activeNote();
  if (!note) return;

  const current = Number(note.discussionFontSize) || 16;
  const next = direction === "increase" ? Math.min(22, current + 2) : Math.max(14, current - 2);
  note.discussionFontSize = next;
  note.updatedAt = new Date().toISOString();
  applyDiscussionFontSize(next);
  scheduleSave();
}

function autoCorrectMeetingNotes() {
  const note = activeNote();
  if (!note) return;

  pushDiscussionUndo();
  const original = getDiscussionText();
  const corrected = original
    .split(/\r?\n/)
    .map(autoCorrectMeetingLine)
    .join("\n");

  renderDiscussionEditor(corrected, corrected.length);
  updateActiveNote("discussion", corrected);
  updateActiveNote("discussionHtml", sanitizeDiscussionHtml(els.noteDiscussion.innerHTML));

  const originalLabel = els.autoCorrectButton.textContent;
  els.autoCorrectButton.textContent = corrected === original ? "Checked" : "Corrected";
  setTimeout(() => {
    els.autoCorrectButton.textContent = originalLabel;
  }, 1200);
}

function autoCorrectMeetingLine(line) {
  const leading = line.match(/^\s*(?:-\*\*|-\*|\*\*|\*|[-\u2022>]|\d+[.)])?\s*/)?.[0] || "";
  let body = line.slice(leading.length);

  body = body
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .replace(/\bteh\b/gi, "the")
    .replace(/\btaht\b/gi, "that")
    .replace(/\bthier\b/gi, "their")
    .replace(/\brecieve\b/gi, "receive")
    .replace(/\bseperate\b/gi, "separate")
    .replace(/\bdefinately\b/gi, "definitely")
    .replace(/\bsentance\b/gi, "sentence")
    .replace(/\banythign\b/gi, "anything")
    .replace(/\bnothign\b/gi, "nothing")
    .replace(/\bsomethign\b/gi, "something")
    .replace(/\bnet line\b/gi, "next line")
    .replace(/\bfrist\b/gi, "first")
    .replace(/\bbeleive\b/gi, "believe")
    .replace(/\bbecuase\b/gi, "because")
    .replace(/\bbecuse\b/gi, "because")
    .replace(/\balot\b/gi, "a lot")
    .replace(/\bthru\b/gi, "through")
    .replace(/\bu\b/g, "you")
    .replace(/\bur\b/g, "your")
    .replace(/\bi\b/g, "I")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bill\b/gi, "I'll")
    .replace(/\bive\b/gi, "I've")
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bdidnt\b/gi, "didn't")
    .replace(/\bcant\b/gi, "can't")
    .replace(/\bwont\b/gi, "won't")
    .replace(/\bdoesnt\b/gi, "doesn't")
    .replace(/\bisnt\b/gi, "isn't")
    .replace(/\baren't\b/gi, "aren't")
    .replace(/\bwasnt\b/gi, "wasn't")
    .replace(/\bwerent\b/gi, "weren't")
    .replace(/\bshouldnt\b/gi, "shouldn't")
    .replace(/\bcouldnt\b/gi, "couldn't")
    .replace(/\bwouldnt\b/gi, "wouldn't")
    .replace(/\btheyre\b/gi, "they're")
    .replace(/\bthats\b/gi, "that's")
    .replace(/\bwhats\b/gi, "what's")
    .replace(/\blets\b/gi, "let's")
    .replace(/\babatem?ent\b/gi, "abatement")
    .replace(/\bexxon mobil\b/gi, "Exxon Mobil")
    .replace(/\bkha\b/gi, "KHA")
    .replace(/\bfacade\b/gi, "facade")
    .replace(/\bfacades\b/gi, "facades")
    .replace(/\bscreen shots\b/gi, "screenshots")
    .replace(/\bai\b/g, "AI")
    .replace(/\bpdf\b/g, "PDF")
    .replace(/\bapi\b/g, "API")
    .trim();

  if (body && /^[a-z]/.test(body)) {
    body = body.charAt(0).toUpperCase() + body.slice(1);
  }

  return `${leading}${body}`.trimEnd();
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
  const searchScope = els.searchScope.value;
  if (!question) return;

  if (window.location.protocol === "file:") {
    els.answerBox.textContent = buildLocalQuestionAnswer(question, searchScope);
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
        projectId: searchScope.startsWith("project:") ? searchScope.slice("project:".length) : "",
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI search is not available yet.");
    }

    els.answerBox.textContent = data.answer;
  } catch (error) {
    els.answerBox.textContent = buildLocalQuestionAnswer(question, searchScope);
  } finally {
    els.askButton.disabled = false;
  }
}

function buildLocalQuestionAnswer(question, searchScope = "all") {
  const terms = getQuestionTerms(question);
  const scopeLabel = searchScope.startsWith("project:") ? "in that project" : "across employees and projects";

  if (!terms.length) {
    return "Ask with a little more detail so I know what to look for in your notes.";
  }

  const entries = getSearchEntries(searchScope);
  const matches = entries
    .flatMap(({ employee, project, note }) => getSearchLines(note).map((line) => ({
      employee,
      project,
      note,
      line,
      score: scoreQuestionLine(line, terms, question),
    })))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!matches.length) {
    return [
      `I do not see ${formatQuestionTopic(terms)} mentioned ${scopeLabel}.`,
      "",
      "This is a local note search because AI answers are not connected right now.",
    ].join("\n");
  }

  const directAnswer = isYesNoQuestion(question)
    ? `Yes — I found ${formatQuestionTopic(terms)} in your notes.`
    : `I found these notes about ${formatQuestionTopic(terms)}.`;

  return [
    directAnswer,
    "",
    ...matches.map(({ employee, project, note, line }) => {
      return `- ${employee.name} / ${projectLabel(project)} / ${note.date || "No date"} - ${note.title || "Untitled meeting"}: ${line}`;
    }),
    "",
    "This is a local note search because AI answers are not connected right now.",
  ].join("\n");
}

function getQuestionTerms(question) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "had", "have",
    "does", "did", "can", "could", "would", "should", "what", "when", "where", "why", "how", "our",
    "you", "your", "their", "there", "about", "into", "onto", "any", "all", "do",
  ]);

  return [...new Set(String(question || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !stopWords.has(term)))];
}

function getSearchLines(note) {
  return [
    note.title,
    note.attendees,
    note.discussion,
    note.finalReport,
    ...(Array.isArray(note.actionItems) ? note.actionItems : []),
    ...(Array.isArray(note.decisionItems) ? note.decisionItems : []),
  ]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function scoreQuestionLine(line, terms, question) {
  const lower = line.toLowerCase();
  const tokens = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  const phrase = terms.join(" ");
  let score = phrase && lower.includes(phrase) ? terms.length + 2 : 0;

  terms.forEach((term) => {
    if (tokens.has(term)) score += 1;
  });

  if (isYesNoQuestion(question) && score >= Math.max(1, terms.length)) {
    score += 1;
  }

  return score;
}

function formatQuestionTopic(terms) {
  return terms.length ? `"${terms.join(" ")}"` : "that";
}

function isYesNoQuestion(question) {
  return /^(do|does|did|is|are|was|were|can|could|would|should|have|has|had)\b/i.test(String(question || "").trim());
}

function getSearchEntries(searchScope = "all") {
  if (searchScope.startsWith("project:")) {
    const projectId = searchScope.slice("project:".length);
    const match = allProjectsWithEmployees().find(({ project }) => project.id === projectId);
    if (!match) return [];
    const { employee, project } = match;
    return (project.notes || []).map((note) => ({ employee, project, note }));
  }

  return state.employees.flatMap((employee) =>
    (employee.projects || []).flatMap((project) => (project.notes || []).map((note) => ({ employee, project, note })))
  );
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
  const content = state.employees.map(formatLocalArchiveEmployee).join("\n\n---\n\n");
  const blob = new Blob([content || "No notes to archive."], { type: "text/markdown" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `MA Notes Archive ${today()}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function formatLocalArchiveEmployee(employee) {
  return [
    `# ${employee.name}`,
    "",
    ...(employee.projects || []).map(formatLocalArchiveProject),
  ].join("\n");
}

function formatLocalArchiveProject(project) {
  return [
    `## ${projectLabel(project)}`,
    "",
    ...(project.notes || []).map((note) => [
      `### ${note.title || "Untitled meeting"}`,
      "",
      `Date: ${note.date || "Not listed"}`,
      `Attendees: ${note.attendees || "Not listed"}`,
      "",
      "### Final Report",
      note.finalReport || "No final report created yet.",
      "",
      "### Meeting Notes",
      note.discussion || "No meeting notes.",
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
els.newEmployeeButton.addEventListener("click", () => {
  els.employeeNameInput.value = "";
  els.employeeDialog.showModal();
  setTimeout(() => els.employeeNameInput.focus(), 0);
});
els.employeeSelect.addEventListener("change", (event) => setActiveEmployee(event.target.value));
els.editEmployeeButton.addEventListener("click", renameActiveEmployee);
els.archiveNotesButton.addEventListener("click", archiveNotes);

els.cancelEmployeeButton.addEventListener("click", () => {
  els.employeeDialog.close();
});

els.employeeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (createEmployee(els.employeeNameInput.value)) {
    els.employeeDialog.close();
  }
});

els.cancelProjectButton.addEventListener("click", () => {
  els.projectDialog.close();
});

els.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (createProject(els.clientNameInput.value, els.projectNameInput.value)) {
    els.projectDialog.close();
  }
});

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
els.formatButtons.forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    saveDiscussionSelection();
  });
  button.addEventListener("click", () => runDiscussionCommand(button.dataset.formatCommand));
});
els.fontSizeButtons.forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => adjustDiscussionFontSize(button.dataset.fontSize));
});
els.autoCorrectButton.addEventListener("mousedown", (event) => event.preventDefault());
els.autoCorrectButton.addEventListener("click", autoCorrectMeetingNotes);
els.screenshotPasteZone.addEventListener("paste", handleScreenshotPaste);
els.screenshotPasteZone.addEventListener("click", () => els.screenshotPasteZone.focus());
els.closeScreenshotDialog.addEventListener("click", closeScreenshot);
els.screenshotDialog.addEventListener("click", (event) => {
  if (event.target === els.screenshotDialog) closeScreenshot();
});
els.noteDiscussion.dataset.field = "discussion";
els.noteDiscussion.addEventListener("keyup", saveDiscussionSelection);
els.noteDiscussion.addEventListener("mouseup", saveDiscussionSelection);
els.noteDiscussion.addEventListener("beforeinput", handleDiscussionBeforeInput);
els.noteDiscussion.addEventListener("keydown", handleBulletKeydown);
els.noteDiscussion.addEventListener("paste", handleBulletPaste);
els.noteDiscussion.addEventListener("input", handleDiscussionInput);
els.handwrittenNotesInput.addEventListener("change", handleHandwrittenNotesUpload);
els.handwritingDropZone.addEventListener("dragover", handleHandwritingDragOver);
els.handwritingDropZone.addEventListener("dragleave", handleHandwritingDragLeave);
els.handwritingDropZone.addEventListener("drop", handleHandwritingDrop);
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

loadData().catch((error) => {
  els.answerBox.textContent = `The dashboard could not load notes: ${error.message}`;
});
