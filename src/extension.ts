import * as vscode from 'vscode';

/**
 * Retrieves the text of the current selection or the entire active line if nothing is selected.
 * Validates that multi-line selections are rejected.
 * @param editor The active text editor
 * @returns Success result with the text, or error if selection spans multiple lines
 */
function getLineOrSingleLineSelectionText(editor: vscode.TextEditor): { ok: true; text: string } | { ok: false; error: string } {
  const selection = editor.selection;

  if (!selection.isEmpty) {
    if (selection.start.line !== selection.end.line) {
      return { ok: false, error: 'Selection must be within a single line.' };
    }

    return { ok: true, text: editor.document.getText(selection) };
  }

  const activeLine = editor.selection.active.line;
  return { ok: true, text: editor.document.lineAt(activeLine).text };
}

/**
 * Validates that a step line conforms to BDD Gherkin syntax.
 * Must start with Given, When, or Then (case-insensitive).
 * Rejects lines starting with And/Or and empty lines.
 * @param rawLine The raw step line to validate
 * @returns Success result with trimmed line, or error message
 */
function validateStepLine(rawLine: string): { ok: true; line: string } | { ok: false; error: string } {
  const line = rawLine.trim();
  // Reject empty lines
  if (!line) {
    return { ok: false, error: 'Line is empty/whitespace.' };
  }

  // Reject And/Or conjunctions (must use Given/When/Then)
  if (/^(and|or)\b/i.test(line)) {
    return { ok: false, error: 'Please use Given, When or Then' };
  }

  // Require a valid BDD keyword at the start
  if (!/^(given|when|then)\b/i.test(line)) {
    return { ok: false, error: 'Line must start with the word "Given", "When" or "Then".' };
  }

  return { ok: true, line };
}

/** Valid BDD step keywords used in ATF (Acceptance Test Framework) specifications */
type StepKeyword = 'Given' | 'When' | 'Then';

/**
 * Extracts the BDD keyword and the remainder of the step line.
 * Normalizes the keyword to title case (Given, When, or Then).
 * @param stepLine The validated step line starting with a BDD keyword
 * @returns Success result with keyword and remainder text, or error
 */
function parseStepKeyword(stepLine: string): { ok: true; keyword: StepKeyword; remainder: string } | { ok: false; error: string } {
  // Extract the keyword and remaining text after it
  const match = /^(given|when|then)\b\s*(.*)$/i.exec(stepLine.trim());
  if (!match) {
    return { ok: false, error: 'Line must start with the word "Given", "When" or "Then".' };
  }

  // Normalize keyword to title case
  const keywordRaw = (match[1] ?? '').toLowerCase();
  const keyword: StepKeyword =
    keywordRaw === 'given' ? 'Given' : keywordRaw === 'when' ? 'When' : 'Then';
  const remainder = (match[2] ?? '').trim();
  return { ok: true, keyword, remainder };
}

/**
 * Converts a Gherkin step line into a valid C# method name.
 * Process: removes quoted text, removes punctuation, removes spaces.
 * Example: 'When "message" is displayed' -> 'Whenmessageisdisplayed'
 * @param stepLine The step line to convert
 * @returns A valid C# method name (no spaces or special characters)
 */
function toCSharpMethodName(stepLine: string): string {
  // Remove any text within double quotes (parameters will be added as method arguments)
  const withoutQuotedText = stepLine.replace(/"[^"]*"/g, ' ');
  // Remove any punctuation, keeping only alphanumeric and whitespace
  const withoutPunctuation = withoutQuotedText.replace(/[^a-zA-Z0-9\s]/g, ' ');
  // Remove all spaces to create a valid method name
  return withoutPunctuation.replace(/\s+/g, '');
}

/**
 * Escapes a string for use in a C# string literal (non-interpolated).
 * Escapes backslashes and double quotes.
 * @param value The unescaped string
 * @returns The escaped string suitable for a C# string literal
 */
function escapeForCSharpStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Escapes a string for use as text content inside a C# interpolated string literal.
 * Note: This does NOT handle interpolation expressions in braces.
 * Escapes: backslashes, quotes, and braces (which need doubling in interpolated strings).
 * @param value The unescaped string
 * @returns The escaped string suitable for use in $"..." strings
 */
function escapeForCSharpInterpolatedStringLiteralText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')  // Backslash -> double backslash
    .replace(/"/g, '\\"')    // Quote -> escaped quote
    .replace(/\{/g, '{{')    // { -> {{ (escape braces in interpolated strings)
    .replace(/\}/g, '}}');   // } -> }} (escape braces in interpolated strings)
}

/**
 * Extracts all quoted string literals from a step line.
 * These represent parameters that will become method arguments.
 * Example: 'When "hello" and "world" appear' -> ['hello', 'world']
 * @param stepLine The step line to extract quotes from
 * @returns Array of quoted string contents (without the quotes)
 */
function getQuotedStringLiterals(stepLine: string): string[] {
  const matches: string[] = [];
  const regex = /"([^"]*)"/g;
  let match: RegExpExecArray | null;
  // Global regex requires loop to find all matches
  while ((match = regex.exec(stepLine)) !== null) {
    matches.push(match[1] ?? '');
  }
  return matches;
}

/**
 * Generates the ATF (Acceptance Test Framework) [Given]/[When]/[Then] binding attribute.
 * Converts quoted parameters in the step line to regex patterns.
 * Example: 'When Message "Hello" is displayed' -> '[When(@"Message ""([^""]*)""is displayed")]'
 * @param keyword The BDD keyword (Given, When, or Then)
 * @param remainder The step text after the keyword
 * @returns The C# attribute string for the ATF binding
 */
function generateAtfBindingAttribute(keyword: StepKeyword, remainder: string): string {
  // Replace quoted strings with regex pattern to capture any text in their place
  // " becomes "" (escaped) and the pattern becomes ([^""]*) to capture content
  const pattern = remainder.replace(/\"[^\"]*\"/g, '""([^""]*)""');
  return `[${keyword}(@"${pattern}")]`;
}

/**
 * Builds a C# string assignment that represents the step procedure.
 * For steps with no parameters: creates a simple string literal.
 * For steps with parameters: creates an interpolated string with parameter placeholders.
 * Example: When "msg" is shown -> string proc = $"When {a} is shown";
 * @param stepLine The original step line from the feature file
 * @param parameterNames The parameter names (a, b, c, etc.) corresponding to quoted strings
 * @returns A C# string assignment statement
 */
function buildProcAssignment(stepLine: string, parameterNames: string[]): string {
  // No parameters: simple literal string assignment
  if (parameterNames.length === 0) {
    const procLiteral = escapeForCSharpStringLiteral(stepLine);
    return `string proc = "${procLiteral}";`;
  }

  // Build an interpolated string: iterate through matches and replace each quoted parameter
  let template = '';
  const regex = /"([^"]*)"/g;
  let lastIndex = 0;
  let paramIndex = 0;
  let match: RegExpExecArray | null;

  // Process each quoted section and interleave with parameters
  while ((match = regex.exec(stepLine)) !== null) {
    // Add text before the quote (needs interpolated string escaping)
    const before = stepLine.slice(lastIndex, match.index);
    template += escapeForCSharpInterpolatedStringLiteralText(before);

    // Add the parameter placeholder with escaped quotes around it
    const paramName = parameterNames[paramIndex] ?? `a${paramIndex + 1}`;
    template += `\\"{${paramName}}\\"`;

    lastIndex = match.index + match[0].length;
    paramIndex += 1;
  }

  // Add remaining text after the last quote
  template += escapeForCSharpInterpolatedStringLiteralText(stepLine.slice(lastIndex));
  return `string proc = $"${template}";`;
}

/**
 * Generates a sequence of parameter names for method arguments.
 * Naming scheme: a, b, c, ..., z, a1, b1, ..., z1, a2, ...
 * Supports up to 26 * n parameters (typically sufficient for step parameters).
 * @param count The number of parameter names to generate
 * @returns Array of parameter names
 */
function getParameterNames(count: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    // Cycle through a-z, then add numeric suffix for > 26 params
    const letterIndex = i % 26;
    const suffix = Math.floor(i / 26);
    const name = String.fromCharCode('a'.charCodeAt(0) + letterIndex) + (suffix > 0 ? String(suffix) : '');
    names.push(name);
  }
  return names;
}

/**
 * Generates a complete C# method for an ATF step.
 * Includes the [Given]/[When]/[Then] binding attribute and method implementation.
 * The method body uses CombinedSteps.OutputProc() to validate the step.
 * @param stepLine The original Gherkin step line
 * @returns A formatted C# method string ready to be copied to code
 */
function generateCSharpMethod(stepLine: string): string {
  // Extract components from the step line
  const methodName = toCSharpMethodName(stepLine);
  const quotedValues = getQuotedStringLiterals(stepLine);
  const parameterNames = getParameterNames(quotedValues.length);
  
  // Build method signature with appropriate parameter list
  const signature =
    parameterNames.length === 0
      ? `public bool ${methodName}()`
      : `public bool ${methodName}(${parameterNames.map((n) => `string ${n}`).join(', ')})`;

  // Generate the ATF binding attribute
  const parsed = parseStepKeyword(stepLine);
  const bindingAttribute = parsed.ok ? generateAtfBindingAttribute(parsed.keyword, parsed.remainder) : undefined;

  // Assemble the complete method with proper formatting
  return (
    `     ${bindingAttribute ? `${bindingAttribute}\r\n` : ''}` +  // Attribute (if valid)
    `     ${signature}\r\n` +                                        // Method signature
    `     {\r\n` +                                                   // Opening brace
    `         ${buildProcAssignment(stepLine, parameterNames)}\r\n` + // Proc string assignment
    `     \r\n` +
    `         if (CombinedSteps.OutputProc(proc))\r\n` +            // Call to framework
    `         {\r\n` +
    `             return false;\r\n  // make me true!` +
    `             //return true;\r\n` +
        `    }\r\n` +
        `    CombinedSteps.Failure(proc);\r\n` +
        `    return false;\r\n` +
    `}`
  );
}

/**
 * Activates the extension when VS Code starts.
 * Registers the context menu command that generates ATF C# methods from Gherkin steps.
 * @param context The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  // Register command for the line context menu
  const disposable = vscode.commands.registerCommand(
    'lineContextMenu.useSelectedLine',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage('No active editor.');
        return;
      }

      const lineResult = getLineOrSingleLineSelectionText(editor);
      if (!lineResult.ok) {
        await vscode.env.clipboard.writeText(lineResult.error);
        void vscode.window.showErrorMessage(lineResult.error);
        return;
      }

      const validated = validateStepLine(lineResult.text);
      if (!validated.ok) {
        await vscode.env.clipboard.writeText(validated.error);
        void vscode.window.showErrorMessage(validated.error);
        return;
      }

      const methodText = generateCSharpMethod(validated.line);
      await vscode.env.clipboard.writeText(methodText);
      void vscode.window.showInformationMessage('Copied ATF binding + C# method to clipboard.');
    }
  );

  context.subscriptions.push(disposable);
}

/**
 * Deactivates the extension when VS Code shuts down.
 * No cleanup is required as VS Code manages subscription disposal.
 */
export function deactivate() {}
