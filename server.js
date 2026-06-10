const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "notes.json");
const backupFile = path.join(dataDir, "notes.previous.json");
const archiveDir = path.join(root, "Archived Notes");
const outboxDir = path.join(dataDir, "email-outbox");
const port = Number(process.env.PORT || 4500);

loadEnv();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      writeCorsHeaders(res, 204, {});
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/notes" && req.method === "GET") {
      return sendJson(res, await readNotes());
    }

    if (url.pathname === "/api/notes" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      await writeNotes(normalizeData(parsed), { allowDestructive: Boolean(parsed.allowDestructive) });
      return sendJson(res, { ok: true });
    }

    if (url.pathname === "/api/ask" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const result = await askQuestion(parsed.question, parsed.projectId);
      return sendJson(res, result);
    }

    if (url.pathname === "/api/report" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      return sendJson(res, await createReport(parsed.projectId, parsed.noteId));
    }

    if (url.pathname === "/api/transcribe-notes" && req.method === "POST") {
      const body = await readBody(req, 35_000_000);
      const parsed = JSON.parse(body || "{}");
      return sendJson(res, await transcribeHandwrittenNotes(parsed.image));
    }

    if (url.pathname === "/api/archive" && req.method === "POST") {
      return sendJson(res, await archiveAllNotes());
    }

    if (url.pathname === "/api/email-report" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      return sendJson(res, await createEmailDraft(parsed.projectId, parsed.noteId));
    }

    if (url.pathname === "/api/report-pdf" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const pdf = await createReportPdf(parsed.projectId, parsed.noteId);
      writeCorsHeaders(res, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.fileName}"`,
      });
      res.end(pdf.buffer);
      return;
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    return sendJson(res, { error: error.message || "Something went wrong." }, 500);
  }
});

server.listen(port, () => {
  console.log(`MA Notes is running at http://localhost:${port}`);
});

module.exports = server;

async function readNotes() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const initial = { projects: [] };
    await writeNotes(initial);
    return initial;
  }
}

async function writeNotes(data, options = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  let normalized = normalizeData(data);

  if (!options.allowDestructive && fsSync.existsSync(dataFile)) {
    const current = normalizeData(JSON.parse(await fs.readFile(dataFile, "utf8")));
    normalized = mergeWithoutDeleting(current, normalized);
  }

  if (fsSync.existsSync(dataFile)) {
    await fs.copyFile(dataFile, backupFile);
  }

  await fs.writeFile(dataFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

function normalizeData(data) {
  const employees = Array.isArray(data.employees)
    ? data.employees.map((employee) => ({
        id: String(employee.id || ""),
        name: String(employee.name || "Employee"),
        createdAt: String(employee.createdAt || new Date().toISOString()),
        projects: (employee.projects || []).map(normalizeProject),
      }))
    : [];
  const legacyProjects = Array.isArray(data.projects) ? data.projects.map(normalizeProject) : [];
  const normalizedEmployees = employees.length
    ? employees
    : legacyProjects.length
      ? [
          {
            id: "employee-default",
            name: "My Notes",
            createdAt: new Date().toISOString(),
            projects: legacyProjects,
          },
        ]
      : [];
  const projects = normalizedEmployees.flatMap((employee) => employee.projects);

  return {
    employees: normalizedEmployees,
    projects,
  };
}

function normalizeProject(project) {
  return {
    id: String(project.id || ""),
    clientName: String(project.clientName || ""),
    projectName: String(project.projectName || project.name || "Untitled project"),
    name: String(project.name || formatProjectName(project)),
    createdAt: String(project.createdAt || new Date().toISOString()),
    notes: Array.isArray(project.notes)
      ? project.notes.map((note) => ({
          id: String(note.id || ""),
          title: String(note.title || "Untitled meeting"),
          date: String(note.date || ""),
          meetingType: String(note.meetingType || ""),
          attendees: String(note.attendees || ""),
          attendeeImage: String(note.attendeeImage || ""),
          screenshots: Array.isArray(note.screenshots) ? note.screenshots.map(String) : [],
          discussion: String(note.discussion || note.body || ""),
          discussionHtml: String(note.discussionHtml || ""),
          discussionFontSize: Number(note.discussionFontSize) || 16,
          actionItems: Array.isArray(note.actionItems) ? note.actionItems.map(String) : [],
          completedActionItems: Array.isArray(note.completedActionItems) ? note.completedActionItems.map(String) : [],
          decisionItems: Array.isArray(note.decisionItems) ? note.decisionItems.map(String) : parseLines(note.decisions),
          finalReport: String(note.finalReport || ""),
          createdAt: String(note.createdAt || new Date().toISOString()),
          updatedAt: String(note.updatedAt || new Date().toISOString()),
        }))
      : [],
  };
}

function mergeWithoutDeleting(current, incoming) {
  if ((current.employees || []).length || (incoming.employees || []).length) {
    const employees = new Map();

    (current.employees || []).forEach((employee) => {
      employees.set(employee.id, employee);
    });

    (incoming.employees || []).forEach((incomingEmployee) => {
      const currentEmployee = employees.get(incomingEmployee.id);
      if (!currentEmployee) {
        employees.set(incomingEmployee.id, incomingEmployee);
        return;
      }

      employees.set(incomingEmployee.id, {
        ...currentEmployee,
        ...incomingEmployee,
        projects: mergeProjectsWithoutDeleting(currentEmployee.projects || [], incomingEmployee.projects || []),
      });
    });

    const mergedEmployees = [...employees.values()];
    return {
      employees: mergedEmployees,
      projects: mergedEmployees.flatMap((employee) => employee.projects || []),
    };
  }

  return {
    projects: mergeProjectsWithoutDeleting(current.projects || [], incoming.projects || []),
  };
}

function mergeProjectsWithoutDeleting(currentProjectList, incomingProjectList) {
  const projects = new Map();

  currentProjectList.forEach((project) => {
    projects.set(project.id, project);
  });

  incomingProjectList.forEach((incomingProject) => {
    const currentProject = projects.get(incomingProject.id);
    if (!currentProject) {
      projects.set(incomingProject.id, incomingProject);
      return;
    }

    projects.set(incomingProject.id, {
      ...currentProject,
      ...incomingProject,
      notes: mergeNotesWithoutWiping(currentProject.notes || [], incomingProject.notes || []),
    });
  });

  return [...projects.values()];
}

function mergeNotesWithoutWiping(currentNotes, incomingNotes) {
  const notes = new Map();

  currentNotes.forEach((note) => {
    notes.set(note.id, note);
  });

  incomingNotes.forEach((incomingNote) => {
    const currentNote = notes.get(incomingNote.id);
    if (!currentNote) {
      notes.set(incomingNote.id, incomingNote);
      return;
    }

    notes.set(incomingNote.id, shouldKeepCurrentNote(currentNote, incomingNote) ? currentNote : incomingNote);
  });

  return [...notes.values()];
}

function shouldKeepCurrentNote(currentNote, incomingNote) {
  const currentLength = getMeaningfulNoteLength(currentNote);
  const incomingLength = getMeaningfulNoteLength(incomingNote);
  const incomingIsStarter = incomingLength < 20;
  const currentHasWork = currentLength >= 20;

  return currentHasWork && incomingIsStarter;
}

function getMeaningfulNoteLength(note) {
  return [
    note.attendees,
    note.discussion,
    note.finalReport,
    ...(Array.isArray(note.actionItems) ? note.actionItems : []),
    ...(Array.isArray(note.decisionItems) ? note.decisionItems : []),
  ].join(" ").replace(/^[-\s]+$/, "").trim().length;
}

function isDestructiveOverwrite(current, incoming) {
  const currentStats = getDataStats(current);
  const incomingStats = getDataStats(incoming);

  if (currentStats.projectCount === 0 && currentStats.noteCount === 0) return false;
  if (incomingStats.projectCount < currentStats.projectCount) return true;
  if (incomingStats.noteCount < currentStats.noteCount) return true;

  const lostMeaningfulText = incomingStats.textLength + 20 < currentStats.textLength;
  const lostNoteContent = incomingStats.meaningfulNoteTextLength + 20 < currentStats.meaningfulNoteTextLength;
  const currentHasNotes = currentStats.meaningfulNoteTextLength >= 20;
  const incomingIsMuchSmaller = incomingStats.meaningfulNoteTextLength < Math.max(20, currentStats.meaningfulNoteTextLength * 0.4);

  return currentHasNotes && lostMeaningfulText && lostNoteContent && incomingIsMuchSmaller;
}

function getDataStats(data) {
  const projects = Array.isArray(data.projects) ? data.projects : [];
  return projects.reduce(
    (stats, project) => {
      stats.projectCount += 1;
        stats.textLength += [
          project.clientName,
          project.projectName,
          project.name,
      ].join(" ").trim().length;

      const notes = Array.isArray(project.notes) ? project.notes : [];
      stats.noteCount += notes.length;
      notes.forEach((note) => {
        const meaningfulNoteText = [
          project.clientName,
          project.projectName,
          project.name,
          note.title,
          note.meetingType,
          note.attendees,
          note.discussion,
          note.finalReport,
          ...(Array.isArray(note.actionItems) ? note.actionItems : []),
          ...(Array.isArray(note.completedActionItems) ? note.completedActionItems : []),
          ...(Array.isArray(note.decisionItems) ? note.decisionItems : []),
        ].join(" ").replace(/^[-\s]+$/, "").trim();

        stats.meaningfulNoteTextLength += meaningfulNoteText.length;
        stats.textLength += [
          note.title,
          note.attendees,
          note.discussion,
          note.finalReport,
          ...(Array.isArray(note.actionItems) ? note.actionItems : []),
          ...(Array.isArray(note.completedActionItems) ? note.completedActionItems : []),
          ...(Array.isArray(note.decisionItems) ? note.decisionItems : []),
        ].join(" ").trim().length;
      });

      return stats;
    },
    { projectCount: 0, noteCount: 0, textLength: 0, meaningfulNoteTextLength: 0 }
  );
}

function getLatestChangeTime(data) {
  const projects = Array.isArray(data.projects) ? data.projects : [];
  return projects.reduce((latest, project) => {
    const projectTime = Date.parse(project.createdAt || "") || 0;
    const noteTime = (Array.isArray(project.notes) ? project.notes : []).reduce((noteLatest, note) => {
      const updatedAt = Date.parse(note.updatedAt || note.createdAt || "") || 0;
      return Math.max(noteLatest, updatedAt);
    }, 0);
    return Math.max(latest, projectTime, noteTime);
  }, 0);
}

async function askQuestion(question, projectId) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("AI search needs an OpenAI API key before it can answer questions.");
  }

  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) {
    throw new Error("Type a question first.");
  }

  const data = await readNotes();
  const projects = projectId ? data.projects.filter((item) => item.id === projectId) : data.projects;
  if (!projects.length) {
    throw new Error("No projects are available to search.");
  }

  const context = projects
    .flatMap((project) =>
      project.notes.map((note) => ({
        project,
        note,
      }))
    )
    .map(({ project, note }) => {
      return [
        `Project: ${formatProjectName(project)}`,
        `Title: ${note.title}`,
        `Date: ${note.date}`,
        `Meeting type: ${note.meetingType || "Not listed"}`,
        `Attendees: ${note.attendees}`,
        `Discussion: ${note.discussion}`,
        `Final report: ${note.finalReport || ""}`,
        `Decisions: ${(note.decisionItems || []).join("; ")}`,
        `Action items: ${(note.actionItems || []).join("; ")}`,
      ].join("\n");
    })
    .join("\n\n---\n\n")
    .slice(0, 50000);

  if (!context.trim()) {
    throw new Error("This project does not have enough notes for an AI answer yet.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Answer directly using only the meeting notes provided. For yes/no questions, start with Yes, No, or I do not see that in the notes. Then give the specific note line or project/date that supports the answer. If the notes do not contain the answer, say that clearly and do not guess.",
        },
        {
          role: "user",
          content: `Project: ${project.name}\n\nMeeting notes:\n${context}\n\nQuestion: ${cleanQuestion}`,
        },
      ],
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || "OpenAI could not answer that question.");
  }

  return { answer: extractResponseText(result) };
}

async function createReport(projectId, noteId) {
  const data = await readNotes();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Choose a project first.");
  }

  const note = project.notes.find((item) => item.id === noteId) || project.notes[0];
  if (!note) {
    throw new Error("Add a note first.");
  }

  const parsed = parseReportNotes(note.discussion);
  const fallbackReport = buildFallbackReport(project, note, parsed);

  if (!process.env.OPENAI_API_KEY) {
    return {
      report: fallbackReport,
      actionItems: parsed.actionItems,
      clientDecisions: parsed.clientDecisions,
      usedAi: false,
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Create a clear final meeting report from raw notes. Use plain section headers without Markdown # symbols. Put Action Items first and Client Decisions second. Treat lines marked * as action items and lines marked ** as client decisions. Treat the provided action items and client decisions as authoritative. Do not invent facts.",
        },
        {
          role: "user",
          content: [
            `Project: ${project.name}`,
            `Title: ${note.title}`,
            `Date: ${note.date}`,
            `Meeting type: ${note.meetingType || "Not listed"}`,
            `Attendees: ${note.attendees || "Not listed"}`,
            `Action items from * lines:\n${formatList(parsed.actionItems)}`,
            `Client decisions from ** lines:\n${formatList(parsed.clientDecisions)}`,
            `Other notes:\n${formatList(parsed.notes)}`,
            `Raw notes:\n${note.discussion}`,
          ].join("\n\n"),
        },
      ],
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || "OpenAI could not create the report.");
  }

  return {
    report: extractResponseText(result) || fallbackReport,
    actionItems: parsed.actionItems,
    clientDecisions: parsed.clientDecisions,
    usedAi: true,
  };
}

async function transcribeHandwrittenNotes(image) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Handwriting transcription needs an OpenAI API key.");
  }

  const imageUrl = String(image || "");
  if (!imageUrl.startsWith("data:image/")) {
    throw new Error("Upload an image first.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o",
      input: [
        {
          role: "system",
          content:
            "Transcribe handwritten meeting notes from images. Preserve short bullet-style lines. Use * at the start of action item lines when a star or action marker appears. Use ** only for clear client decisions. Do not invent text. If a word is unclear, use [unclear]. Return only the notes text.",
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Read this handwritten notes photo and return clean note lines." },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Could not transcribe handwritten notes.");
  }

  return {
    text: extractResponseText(data),
  };
}

async function archiveAllNotes() {
  const data = await readNotes();
  await fs.mkdir(archiveDir, { recursive: true });

  let noteCount = 0;
  let projectCount = 0;

  const employees = data.employees?.length ? data.employees : [{ name: "My Notes", projects: data.projects }];

  for (const employee of employees) {
    const employeeFolder = path.join(archiveDir, sanitizePathSegment(employee.name || "Employee"));

    for (const project of employee.projects || []) {
      const projectFolder = path.join(employeeFolder, sanitizePathSegment(formatProjectName(project)));
      await fs.mkdir(projectFolder, { recursive: true });
      projectCount += 1;

      for (const [index, note] of project.notes.entries()) {
        const fileName = buildArchiveFileName(note, index);
        const filePath = path.join(projectFolder, fileName);
        await fs.writeFile(filePath, formatArchiveMarkdown(project, note), "utf8");
        noteCount += 1;
      }
    }
  }

  return {
    ok: true,
    archiveDir,
    projectCount,
    noteCount,
  };
}

async function createEmailDraft(projectId, noteId) {
  const pdf = await createReportPdf(projectId, noteId);
  await fs.mkdir(outboxDir, { recursive: true });
  const pdfPath = path.join(outboxDir, pdf.fileName);
  await fs.writeFile(pdfPath, pdf.buffer);

  const subject = `${pdf.projectName} - ${pdf.noteTitle || "Meeting Report"}`;
  const body = `${pdf.projectName}\n${pdf.noteDate || "No date listed"}\n\nAttached is the final meeting report PDF.`;

  await openOutlookDraft(subject, body, pdfPath);
  return { ok: true, pdfPath };
}

async function createReportPdf(projectId, noteId) {
  const data = await readNotes();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Choose a project first.");

  const note = project.notes.find((item) => item.id === noteId) || project.notes[0];
  if (!note) throw new Error("Create the final report first.");

  const text = buildPlainReportText(project, note);
  const fileName = `${sanitizePathSegment(formatProjectName(project))} - ${sanitizePathSegment(note.title || "Meeting Report")}.pdf`;
  return {
    buffer: buildSimplePdf(text),
    fileName,
    projectName: formatProjectName(project),
    noteTitle: note.title,
    noteDate: note.date,
  };
}

function openOutlookDraft(subject, body, attachmentPath) {
  const command = [
    "$ErrorActionPreference = 'Stop';",
    "$outlook = New-Object -ComObject Outlook.Application;",
    "$mail = $outlook.CreateItem(0);",
    `$mail.Subject = ${toPowerShellString(subject)};`,
    `$mail.Body = ${toPowerShellString(body)};`,
    `$mail.Attachments.Add(${toPowerShellString(attachmentPath)}) | Out-Null;`,
    "$mail.Display();",
  ].join(" ");

  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function toPowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPlainReportText(project, note) {
  const parsed = parseReportNotes(note.discussion);
  const actionItems = note.actionItems?.length ? note.actionItems : parsed.actionItems;
  const completed = Array.isArray(note.completedActionItems) ? note.completedActionItems : [];
  const decisions = note.decisionItems?.length ? note.decisionItems : parsed.clientDecisions;
  const notes = parsed.notes;

  return [
    formatProjectName(project),
    note.date || "No date listed",
    "",
    "Action Items",
    actionItems.length ? actionItems.map((item) => `${completed.includes(item) ? "[x]" : "[ ]"} ${item}`).join("\n") : "None noted",
    "",
    "Decisions",
    formatPlainList(decisions),
    "",
    "Notes",
    formatPlainList(notes),
  ].join("\n");
}

function formatPlainList(items) {
  return items.length ? items.map((item) => `${getReportItemIndent(item)}- ${String(item).trim()}`).join("\n") : "None noted";
}

function buildSimplePdf(text) {
  const lines = wrapPdfLines(String(text || ""), 88);
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
    const stream = buildPdfPageStream(pageLines);
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

function buildPdfPageStream(lines) {
  return [
    "BT",
    "/F1 11 Tf",
    "50 752 Td",
    "14 TL",
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET",
  ].join("\n");
}

function wrapPdfLines(text, maxLength) {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [""];
    const indent = line.match(/^\s*/)?.[0] || "";
    const words = line.trim().split(/\s+/);
    const lines = [];
    let current = indent;
    words.forEach((word) => {
      const next = current.trim() ? `${current} ${word}` : `${current}${word}`;
      if (next.length > maxLength) {
        if (current) lines.push(current);
        current = `${indent}${word}`;
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

function buildArchiveFileName(note, index) {
  const date = sanitizePathSegment(note.date || "No date");
  const title = sanitizePathSegment(note.title || "Untitled meeting");
  const id = sanitizePathSegment(note.id || `note-${index + 1}`).slice(-12);
  return `${date} - ${title} - ${id}.md`;
}

function formatArchiveMarkdown(project, note) {
  const parsed = parseReportNotes(note.discussion);
  const actionItems = note.actionItems?.length ? note.actionItems : parsed.actionItems;
  const clientDecisions = note.decisionItems?.length ? note.decisionItems : parsed.clientDecisions;
  const completedActionItems = Array.isArray(note.completedActionItems) ? note.completedActionItems : [];

  return [
    `# ${note.title || "Untitled meeting"}`,
    "",
    `Project: ${formatProjectName(project)}`,
    `Date: ${note.date || "Not listed"}`,
    `Meeting Type: ${note.meetingType || "Not listed"}`,
    `Attendees: ${note.attendees || "Not listed"}`,
    "",
    "## Action Items",
    formatChecklist(actionItems, completedActionItems),
    "",
    "## Client Decisions",
    formatList(clientDecisions),
    "",
    "## Final Report",
    note.finalReport?.trim() || "No final report created yet.",
    "",
    "## Meeting Notes",
    note.discussion?.trim() || "No meeting notes.",
    "",
  ].join("\n");
}

function sanitizePathSegment(value) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return (cleaned || "Untitled").slice(0, 120);
}

function formatChecklist(items, completedItems) {
  return items.length
    ? items.map((item) => `- [${completedItems.includes(item) ? "x" : " "}] ${item}`).join("\n")
    : "- None noted";
}

function parseReportNotes(discussion) {
  const actionItems = [];
  const clientDecisions = [];
  const notes = [];

  String(discussion || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .forEach((line) => {
      const trimmedLine = line.trim();
      if (isClientDecisionLine(trimmedLine)) {
        clientDecisions.push(cleanMarkedLine(trimmedLine.replace(/^-?\s*\*\*/, "")));
        return;
      }

      if (isActionItemLine(trimmedLine)) {
        actionItems.push(cleanMarkedLine(trimmedLine.replace(/^-?\s*\*/, "")));
        return;
      }

      notes.push(cleanNoteLine(line));
    });

  return {
    actionItems: actionItems.filter(Boolean),
    clientDecisions: clientDecisions.filter(Boolean),
    notes: notes.filter(Boolean),
  };
}

function cleanMarkedLine(value) {
  return String(value || "").replace(/^[-*\u2022\d.)\s]+/, "").trim();
}

function cleanNoteLine(value) {
  const line = String(value || "");
  const indent = line.match(/^\s*/)?.[0] || "";
  const text = line.slice(indent.length).replace(/^[-\u2022\d.)]+\s*/, "").trim();
  return text ? `${indent}${text}` : "";
}

function getReportItemIndent(item) {
  return String(item || "").match(/^\s*/)?.[0] || "";
}

function isActionItemLine(line) {
  return /^-?\s*\*(?!\*)\s*/.test(line);
}

function isClientDecisionLine(line) {
  return /^-?\s*\*\*\s*/.test(line);
}

function buildFallbackReport(project, note, parsed) {
  return [
    `${project.name}`,
    "",
    `Date: ${note.date || "Not listed"}`,
    `Meeting Type: ${note.meetingType || "Not listed"}`,
    `Attendees: ${note.attendees || "Not listed"}`,
    "",
    "Action Items",
    formatList(parsed.actionItems),
    "",
    "Decisions",
    formatList(parsed.clientDecisions),
    "",
    "Notes",
    formatList(parsed.notes),
  ].join("\n");
}

function formatList(items) {
  return items.length ? items.map((item) => `${getReportItemIndent(item)}- ${String(item).trim()}`).join("\n") : "- None noted";
}

function extractResponseText(result) {
  if (typeof result.output_text === "string" && result.output_text.trim()) {
    return result.output_text.trim();
  }

  const text = [];
  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        text.push(content.text);
      }
    }
  }
  return text.join("\n").trim() || "I could not find an answer in the notes.";
}

function formatProjectName(project) {
  const clientName = String(project.clientName || "").trim();
  const projectName = String(project.projectName || "").trim();
  if (clientName && projectName) return `${clientName} / ${projectName}`;
  return projectName || clientName || "Untitled project";
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\u2022\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fsSync.existsSync(envPath)) return;

  const raw = fsSync.readFileSync(envPath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...valueParts] = trimmed.split("=");
    if (!key || process.env[key]) return;
    process.env[key] = valueParts.join("=").trim();
  });
}

function readBody(req, maxLength = 15_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxLength) {
        req.destroy();
        reject(new Error("Request is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] || "application/octet-stream";
  const content = await fs.readFile(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

function sendJson(res, data, status = 200) {
  writeCorsHeaders(res, status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function writeCorsHeaders(res, status, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
}
