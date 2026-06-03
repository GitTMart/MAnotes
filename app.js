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
      ? "Added AI-read notes to Discussion."
      : "Added OCR text to Discussion. For better handwriting results, run the local server with an OpenAI API key.";
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
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);

  const entries = getSearchEntries(searchScope);
  const matches = entries
    .map(({ employee, project, note }) => {
      const text = getNoteSearchText(note);
      const score = terms.reduce((count, term) => count + (text.toLowerCase().includes(term) ? 1 : 0), 0);
      return { employee, project, note, score, text };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (!matches.length) {
    return `AI answers are not connected in this version of the app.\n\nI did not find matching notes ${searchScope.startsWith("project:") ? "in that project" : "across employees and projects"} yet.`;
  }

  return [
    "AI answers are not connected in this version of the app.",
    "",
    `Best matches ${searchScope.startsWith("project:") ? "from that project" : "across employees and projects"}:`,
    ...matches.map(({ employee, project, note }) => {
      const preview = String(note.discussion || note.finalReport || "No note details yet.").replace(/\s+/g, " ").trim();
      return `- ${employee.name} / ${projectLabel(project)} / ${note.date || "No date"} - ${note.title || "Untitled meeting"}: ${preview.slice(0, 220)}${preview.length > 220 ? "..." : ""}`;
    }),
  ].join("\n");
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
els.noteDiscussion.dataset.field = "discussion";
els.noteDiscussion.addEventListener("focus", () => setBulletCaret(els.noteDiscussion));
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
