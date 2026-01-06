import * as vscode from 'vscode';

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

function validateStepLine(rawLine: string): { ok: true; line: string } | { ok: false; error: string } {
  const line = rawLine.trim();
  if (!line) {
    return { ok: false, error: 'Line is empty/whitespace.' };
  }

  if (/^(and|or)\b/i.test(line)) {
    return { ok: false, error: 'Please use Given, When or Then' };
  }

  if (!/^(given|when|then)\b/i.test(line)) {
    return { ok: false, error: 'Line must start with the word "Given", "When" or "Then".' };
  }

  return { ok: true, line };
}

type StepKeyword = 'Given' | 'When' | 'Then';

function parseStepKeyword(stepLine: string): { ok: true; keyword: StepKeyword; remainder: string } | { ok: false; error: string } {
  const match = /^(given|when|then)\b\s*(.*)$/i.exec(stepLine.trim());
  if (!match) {
    return { ok: false, error: 'Line must start with the word "Given", "When" or "Then".' };
  }

  const keywordRaw = (match[1] ?? '').toLowerCase();
  const keyword: StepKeyword =
    keywordRaw === 'given' ? 'Given' : keywordRaw === 'when' ? 'When' : 'Then';
  const remainder = (match[2] ?? '').trim();
  return { ok: true, keyword, remainder };
}

function toCSharpMethodName(stepLine: string): string {
  // Spec additions:
  // - Remove any punctuation from the method name.
  // - Remove any text within double quotes from the method name.
  // - Then remove spaces.
  const withoutQuotedText = stepLine.replace(/"[^"]*"/g, ' ');
  const withoutPunctuation = withoutQuotedText.replace(/[^a-zA-Z0-9\s]/g, ' ');
  return withoutPunctuation.replace(/\s+/g, '');
}

function escapeForCSharpStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeForCSharpInterpolatedStringLiteralText(value: string): string {
  // Escapes text content inside a C# interpolated string ($"...")
  // (not including the interpolation holes like {a}).
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}');
}

function getQuotedStringLiterals(stepLine: string): string[] {
  const matches: string[] = [];
  const regex = /"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stepLine)) !== null) {
    matches.push(match[1] ?? '');
  }
  return matches;
}

function generateAtfBindingAttribute(keyword: StepKeyword, remainder: string): string {
  // Example:
  // remainder: Message "Hello" Is Not Displayed
  // binding:  Message ""([^""]*)"" Is Not Displayed (inside a verbatim string)
  const pattern = remainder.replace(/\"[^\"]*\"/g, '""([^""]*)""');
  return `[${keyword}(@"${pattern}")]`;
}

function buildProcAssignment(stepLine: string, parameterNames: string[]): string {
  if (parameterNames.length === 0) {
    const procLiteral = escapeForCSharpStringLiteral(stepLine);
    return `string proc = "${procLiteral}";`;
  }

  // Build an interpolated string that preserves quotes and replaces each quoted literal with a parameter.
  let template = '';
  const regex = /"([^"]*)"/g;
  let lastIndex = 0;
  let paramIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(stepLine)) !== null) {
    const before = stepLine.slice(lastIndex, match.index);
    template += escapeForCSharpInterpolatedStringLiteralText(before);

    const paramName = parameterNames[paramIndex] ?? `a${paramIndex + 1}`;
    template += `\\"{${paramName}}\\"`;

    lastIndex = match.index + match[0].length;
    paramIndex += 1;
  }

  template += escapeForCSharpInterpolatedStringLiteralText(stepLine.slice(lastIndex));
  return `string proc = $"${template}";`;
}

function getParameterNames(count: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const letterIndex = i % 26;
    const suffix = Math.floor(i / 26);
    const name = String.fromCharCode('a'.charCodeAt(0) + letterIndex) + (suffix > 0 ? String(suffix) : '');
    names.push(name);
  }
  return names;
}

function generateCSharpMethod(stepLine: string): string {
  const methodName = toCSharpMethodName(stepLine);
  const quotedValues = getQuotedStringLiterals(stepLine);
  const parameterNames = getParameterNames(quotedValues.length);
  const signature =
    parameterNames.length === 0
      ? `public bool ${methodName}()`
      : `public bool ${methodName}(${parameterNames.map((n) => `string ${n}`).join(', ')})`;

  const parsed = parseStepKeyword(stepLine);
  const bindingAttribute = parsed.ok ? generateAtfBindingAttribute(parsed.keyword, parsed.remainder) : undefined;

  return (
    `${bindingAttribute ? `${bindingAttribute}\r\n` : ''}` +
    `${signature}\r\n` +
    `{\r\n` +
    `    ${buildProcAssignment(stepLine, parameterNames)}\r\n` +
    `\r\n` +
    `    if (CombinedSteps.OutputProc(proc))\r\n` +
    `    {\r\n` +
    `        return false;\r\n` +
    `    }\r\n` +
    `\r\n` +
    `    return false;\r\n` +
    `}`
  );
}

export function activate(context: vscode.ExtensionContext) {
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

export function deactivate() {}
