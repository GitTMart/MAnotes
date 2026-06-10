# MA Notes

This is a local dashboard for project-based meeting notes.

## Start

Double-click `start-dashboard.bat`. It starts the local app and opens:

http://localhost:4500

Bookmark `http://localhost:4500` in your browser. The bookmark works whenever `start-dashboard.bat` is running.

## AI Search

Keyword search works immediately.

To enable AI answers:

1. Make a copy of `.env.example`.
2. Rename the copy to `.env`.
3. Put your OpenAI API key after `OPENAI_API_KEY=`.
4. Restart the dashboard.

Your notes are stored locally in `data/notes.json`.

## Meeting Flow

- Create employee workspaces from the Employees section.
- Switch employees to see that employee's own projects and notes.
- Projects are labeled by Client and Project name.
- Projects appear in the left list and as tabs across the top for the selected employee.
- Click a project on the left to see that project's full saved note history.
- Take meeting notes in the Meeting Notes area.
- Meeting Notes starts as a plain writing area. Use the Bullet button when you want a bulleted line; pressing Enter on a bulleted line continues the bullet. Use Tab / Shift+Tab to indent or outdent.
- Use the formatting bar below Handwritten Notes for bold, italic, underline, bullets, indent, outdent, font size, and auto correct.
- Pasted rich notes keep bold text and nested bullets in Meeting Notes.
- Start a line with `*` for an Action Item.
- Start a line with `**` for a Client Decision.
- Click Create Report to organize the note into a final report.
- The Find Anything section sits above notes and can be collapsed. AI search checks all employees and projects by default, or you can choose one project from the scope dropdown.
- You can paste an attendee screenshot into the attendee screenshot box, or paste while the attendee field is active.
- You can paste meeting screenshots into the screenshot boxes beside the notes, then click a screenshot to enlarge it.
- Click Archive Notes to export all notes into employee and project folders under `Archived Notes`.
