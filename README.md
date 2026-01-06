# Line Context Menu (VS Code Extension)

Adds an editor right-click menu command that generates a C# step method from a single line and copies it to the clipboard.

## Run locally

1. Install dependencies:
   - `npm install`
2. Press `F5` (Run Extension).
3. In the Extension Development Host window:
   - (Optional) Select text within a single line
   - Right-click in the editor
   - Click **Generate C# Step Method**

If you have a single-line selection, that text is used. Otherwise, the entire current cursor line is used.

Rules:
- The line must start with `Given`, `When`, or `Then`.
- If the line starts with `And` or `Or`, you get an error: `Please use Given, When or Then`.
- Any error is also copied to the clipboard.
