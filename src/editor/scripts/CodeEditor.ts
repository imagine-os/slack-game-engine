import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { memberType, parseApi } from './apiDocs';

/** Dark theme matching the editor chrome. */
const forgeTheme = EditorView.theme({
  '&': { backgroundColor: '#0f1219', color: '#e8eaf0', height: '100%', fontSize: '13px' },
  '.cm-content': { fontFamily: 'var(--mono)', caretColor: '#ff7a3d', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ff7a3d' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(76,194,255,0.25)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.05)' },
  '.cm-gutters': { backgroundColor: '#0d0f14', color: '#5c6378', border: 'none', borderRight: '1px solid rgba(255,255,255,0.06)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '36px' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(76,194,255,0.25)', outline: '1px solid rgba(76,194,255,0.5)' },
  '.cm-tooltip': { backgroundColor: '#1c2030', border: '1px solid rgba(255,255,255,0.12)', color: '#e8eaf0', borderRadius: '8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(255,122,61,0.25)', color: '#fff' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', fontSize: '12px' },
  '.cm-completionDetail': { color: '#9aa1b5', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-completionInfo': { backgroundColor: '#1c2030', border: '1px solid rgba(255,255,255,0.12)', color: '#c8cdd8', fontSize: '12px', maxWidth: '360px' },
  '.cm-panels': { backgroundColor: '#151823', color: '#e8eaf0', borderBottom: '1px solid rgba(255,255,255,0.09)' },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255,209,102,0.3)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255,209,102,0.6)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(76,194,255,0.15)' },
  '.cm-lint-marker-error': { content: '"●"', color: '#ff5c7a' },
  '.cm-diagnostic-error': { borderLeft: '3px solid #ff5c7a' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff5c7a' },
  '.cm-foldPlaceholder': { backgroundColor: '#1c2030', border: 'none', color: '#9aa1b5' },
}, { dark: true });

const forgeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#e8eaf0' },
  { tag: [t.propertyName], color: '#82aaff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.string, t.special(t.string)], color: '#c3e88d' },
  { tag: [t.number, t.bool, t.null], color: '#f78c6c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#5c6378', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: '#89ddff' },
  { tag: [t.definition(t.variableName), t.local(t.variableName)], color: '#ffcb6b' },
  { tag: t.typeName, color: '#ffcb6b' },
  { tag: t.invalid, color: '#ff5c7a' },
]);

/** Line/column position of a syntax error reported by the linter. */
export interface EditorProblem { from: number; to: number; message: string }

export interface CodeEditorOptions {
  onChange?: (source: string) => void;
  onSave?: () => void;
  /** Extra completions specific to the current file (script prop names). */
  propsProvider?: () => string[];
}

/**
 * CodeMirror 6 wrapper: JavaScript mode, dark theme, line numbers, folding,
 * bracket matching, search, syntax-error lint and API-aware autocompletion
 * generated from `SCRIPT_API_DTS`.
 */
export class CodeEditor {
  readonly view: EditorView;
  private readonly readOnly = new Compartment();
  private externalProblems: EditorProblem[] = [];

  constructor(parent: HTMLElement, private readonly opts: CodeEditorOptions = {}) {
    const extensions: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), foldGutter(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
      history(), search({ top: true }), highlightSelectionMatches(), lintGutter(),
      javascript(),
      syntaxHighlighting(forgeHighlight), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      autocompletion({ override: [(ctx) => this.complete(ctx)], activateOnTyping: true, icons: false }),
      linter((view) => this.lint(view), { delay: 300 }),
      placeholder('defineScript({ name: "MyScript", onUpdate(ctx, dt) { } })'),
      keymap.of([
        { key: 'Mod-s', run: () => { this.opts.onSave?.(); return true; }, preventDefault: true },
        indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap,
      ]),
      EditorView.updateListener.of((u) => { if (u.docChanged) this.opts.onChange?.(u.state.doc.toString()); }),
      this.readOnly.of(EditorState.readOnly.of(false)),
      forgeTheme,
      EditorView.lineWrapping,
    ];
    this.view = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent });
  }

  get source(): string { return this.view.state.doc.toString(); }

  /** Replace the document (resets undo history when `resetHistory`). */
  setSource(text: string): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  setReadOnly(ro: boolean): void {
    this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(ro)) });
  }

  /** Show additional diagnostics (e.g. compile errors) inline. */
  setProblems(problems: EditorProblem[]): void {
    this.externalProblems = problems;
    // Trigger a re-lint by dispatching an empty transaction with the lint source re-run.
    this.view.dispatch({});
  }

  /** Position from a 1-based line number. */
  lineRange(line: number): { from: number; to: number } {
    const l = this.view.state.doc.line(Math.max(1, Math.min(this.view.state.doc.lines, line)));
    return { from: l.from, to: l.to };
  }

  focus(): void { this.view.focus(); }

  private lint(view: EditorView): CmDiagnostic[] {
    const out: CmDiagnostic[] = [];
    syntaxTree(view.state).cursor().iterate((node) => {
      if (node.type.isError) {
        const from = node.from, to = Math.max(node.to, node.from + 1);
        out.push({ from, to: Math.min(to, view.state.doc.length), severity: 'error', message: 'Syntax error' });
      }
    });
    for (const p of this.externalProblems) out.push({ from: Math.min(p.from, view.state.doc.length), to: Math.min(p.to, view.state.doc.length), severity: 'error', message: p.message });
    return out;
  }

  // -------------------------------------------------------- completions

  private complete(ctx: CompletionContext): CompletionResult | null {
    const api = parseApi();
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 200), ctx.pos);
    const chain = /([\w.]+)\.(\w*)$/.exec(before);
    if (chain) {
      const path = chain[1].split('.');
      const word = chain[2];
      let typeName: string | null = null;
      if (path[0] === 'ctx') {
        typeName = 'ScriptContext';
        for (let i = 1; i < path.length && typeName; i++) {
          const iface = api.find((x) => x.name === typeName);
          const m = iface?.members.find((mm) => mm.name === path[i]);
          typeName = m ? memberType(m.signature) : null;
          if (path[i] === 'props') {
            const props = this.opts.propsProvider?.() ?? [];
            return { from: ctx.pos - word.length, options: props.map((p) => ({ label: p, type: 'property' })), validFor: /^\w*$/ };
          }
        }
      } else if (path[0] === 'math') typeName = 'MathNS';
      else if (path[0] === 'console') return { from: ctx.pos - word.length, options: ['log', 'warn', 'error', 'info'].map((l) => ({ label: l, type: 'function', apply: `${l}(` })), validFor: /^\w*$/ };
      else {
        const guess = api.find((x) => x.name.toLowerCase() === path[path.length - 1].toLowerCase());
        if (guess) typeName = guess.name;
      }
      const iface = typeName ? api.find((x) => x.name === typeName) : undefined;
      if (!iface) return null;
      return {
        from: ctx.pos - word.length,
        options: iface.members.map((m): Completion => ({
          label: m.name,
          type: m.kind === 'method' ? 'function' : 'property',
          detail: m.signature.replace(m.name, '').replace(/^\??:?\s*/, ''),
          info: m.doc,
          apply: m.kind === 'method' && !/^\w+\(\)/.test(m.signature) ? `${m.name}(` : m.kind === 'method' ? `${m.name}()` : m.name,
        })),
        validFor: /^\w*$/,
      };
    }
    const word = ctx.matchBefore(/\w+/);
    if (!word && !ctx.explicit) return null;
    const def = api.find((x) => x.name === 'ScriptDefinition');
    const hooks = (def?.members ?? []).filter((m) => m.kind === 'method').map((m): Completion => ({ label: m.name, type: 'method', detail: 'hook', info: m.doc, apply: `${m.name}(${m.signature.includes('dt') ? 'ctx, dt' : m.signature.includes('other') ? 'ctx, other, info' : m.signature.includes('snapshot') ? 'ctx, input, dt' : 'ctx'}) {\n  \n},` }));
    const globals: Completion[] = [
      { label: 'defineScript', type: 'function', apply: 'defineScript({\n  name: \'\',\n  onStart(ctx) {\n  },\n});', detail: 'declare the script' },
      { label: 'ctx', type: 'variable', detail: 'ScriptContext' },
      { label: 'math', type: 'namespace', detail: 'Vec2, Vec3, Color, clamp, lerp…' },
      { label: 'console', type: 'variable' },
      ...['const', 'let', 'function', 'return', 'if', 'else', 'for', 'while', 'true', 'false', 'null', 'undefined', 'this', 'Math', 'JSON', 'Object', 'Array'].map((k) => ({ label: k, type: 'keyword' })),
    ];
    return { from: word ? word.from : ctx.pos, options: [...hooks, ...globals], validFor: /^\w*$/ };
  }

  dispose(): void { this.view.destroy(); }
}
