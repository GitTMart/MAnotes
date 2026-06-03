# TC Notes Dashboard

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

- Projects are labeled by Client and Project name.
- Projects appear in the left list and as tabs across the top.
- Click a project on the left to see that project's full saved note history.
- Take meeting notes in the Discussion area.
- Discussion automatically starts new lines as bullet points, and Tab / Shift+Tab indent or outdent bullets.
- Start a line with `-*` for an Action Item.
- Start a line with `-**` for a Client Decision.
- Click Create Report to organize the note into a final report.
- The Find Anything section sits above notes and can be collapsed.
- You can paste an attendee screenshot into the attendee screenshot box, or paste while the attendee field is active.
- Click Archive Notes to export all notes into project folders under `Archived Notes`.
