import * as vscode from 'vscode';
import { htmlLang } from '../i18n';

/**
 * Shared plain-looking webview shell: VSCode theme variables only, no custom
 * backgrounds, no decorations — text-first per the project's design rules.
 */
export function shellHtml(title: string, body: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="${htmlLang()}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; frame-src https:;">
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0 24px 48px;
    max-width: 980px;
    margin: 0 auto;
  }
  h1 { font-size: 1.45em; font-weight: 600; margin: 1.2em 0 0.4em; }
  h2 { font-size: 1.15em; font-weight: 600; margin: 1.6em 0 0.5em; color: var(--vscode-foreground); }
  h2 .sub { font-weight: 400; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0 1em; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; font-weight: 400; }
  th { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  td.num { text-align: right; font-family: var(--vscode-editor-font-family); white-space: nowrap; }
  tr.total td { font-weight: 600; }
  .live { color: var(--vscode-errorForeground); font-weight: 600; }
  .won { color: var(--vscode-charts-green); }
  .ratingPositive { color: var(--vscode-charts-green); }
  .ratingNegative { color: var(--vscode-errorForeground); }
  .ratingNeutral { color: var(--vscode-descriptionForeground); }
  details { border: 1px solid var(--vscode-panel-border); margin: 0.4em 0; padding: 6px 10px; }
  details > summary { cursor: pointer; user-select: none; }
  details[open] > summary { margin-bottom: 0.5em; }
  .btnrow { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.5em 0; align-items: center; }
  button {
    background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border); border-radius: 2px;
    padding: 2px 10px; cursor: pointer; font-size: 0.85em;
  }
  button.active { border-color: var(--vscode-focusBorder); color: var(--vscode-focusBorder); }
  .placeholder {
    border: 1px dashed var(--vscode-panel-border); color: var(--vscode-descriptionForeground);
    padding: 8px 12px; margin: 0.5em 0; display: inline-block;
  }
  .media-toggle {
    position: fixed; top: 12px; right: 18px; z-index: 10;
  }
  .media-slot.filled .placeholder { display: none; }
  /* Eco-adjusted toggle: body.eco swaps traditional <-> eco-adjusted columns */
  body:not(.eco) .eco { display: none; }
  body.eco .trad { display: none; }
  blockquote { border-left: 3px solid var(--vscode-panel-border); margin: 0.6em 0; padding: 2px 14px; color: var(--vscode-descriptionForeground); }
  .comment { margin: 0.5em 0; padding-top: 0.5em; border-top: 1px solid var(--vscode-panel-border); }
  .comment .head { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .comment .author { color: var(--vscode-foreground); font-weight: 600; }
  .muted { color: var(--vscode-descriptionForeground); }
  .teamgrid { display: flex; flex-wrap: wrap; gap: 4px 18px; }
  .logbox { font-family: var(--vscode-editor-font-family); font-size: 0.85em; white-space: pre-wrap; border: 1px solid var(--vscode-panel-border); padding: 8px 10px; max-height: 260px; overflow-y: auto; }
  a { color: var(--vscode-textLink-foreground); }
  .matchline { font-size: 1.05em; margin: 0.2em 0; }
  .score-big { font-family: var(--vscode-editor-font-family); font-size: 1.6em; font-weight: 600; }
  hr { border: 0; border-top: 1px solid var(--vscode-panel-border); margin: 1.5em 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Panel bookkeeping: one panel per key, reused when re-opened. */
export class PanelRegistry {
  private panels = new Map<string, vscode.WebviewPanel>();

  public getOrCreate(
    key: string,
    create: () => vscode.WebviewPanel,
  ): { panel: vscode.WebviewPanel; existed: boolean } {
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return { panel: existing, existed: true };
    }
    const panel = create();
    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));
    return { panel, existed: false };
  }
}
