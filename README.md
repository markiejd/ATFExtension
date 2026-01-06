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
## Build a VSIX package

To create a `.vsix` file for distribution or local installation:

1. Install the packaging tool globally:
   ```bash
   npm install -g @vscode/vsce
   ```

2. Package the extension:
   ```bash
   npx vsce package --allow-missing-repository
   ```

2.1 *you may be asked about licence - for now (version 0.1) you can ignore

3. The `.vsix` file will be created in the project root directory.
   - Current filename: **`MJD.atf-context-menu-0.0.2.vsix`**
   - Format: `{publisher}.{name}-{version}.vsix`

4. To install the VSIX locally in VS Code:
   - Go to Extensions view (Ctrl+Shift+X)
   - Click the **...** menu
   - Select **Install from VSIX...**
   - Choose the generated `.vsix` file

### Customizing the package

To change the publisher, extension name, or version in future builds, edit `package.json`:

```json
{
  "name": "atf-context-menu",        // Change the extension name here
  "version": "0.0.2",                 // Update version for new releases
  "publisher": "MJD",                 // Change publisher ID here
  ...
}
```

The VSIX filename will automatically update based on these values when you run `vsce package` again.