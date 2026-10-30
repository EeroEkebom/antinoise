/** Agent console panel visualising the commissioning agent's reasoning trail:
 * what it observed (state) → what it decided → what it applied. UI-only in Wave 2;
 * Wave 3's BrainInterface writes into it regardless of inference route. */
export type ConsoleEntry = { state: string; decision: string; applied: string };

const MAX_ROWS = 50;

export type AgentConsole = ReturnType<typeof createAgentConsole>;

export function createAgentConsole(host: HTMLElement): {
  log(entry: ConsoleEntry): void;
  setStatus(text: string, live: boolean): void;
  /** Test/support accessor: text of the i-th (0 = newest) trail row. */
  rowText(i: number): string | null;
} {
  host.classList.add('agent-console');
  host.innerHTML = `
    <div class="console-head">
      <span class="status-dot dot-idle"></span>
      <span class="head-text">Commissioning agent</span>
      <span class="status-text">idle</span>
    </div>
    <div class="trail"></div>
  `;
  const trail = host.querySelector<HTMLDivElement>('.trail')!;
  const dot = host.querySelector<HTMLElement>('.status-dot')!;
  const status = host.querySelector<HTMLElement>('.status-text')!;

  return {
    log(entry: ConsoleEntry): void {
      const row = document.createElement('div');
      row.className = 'trail-row';
      row.innerHTML = `
        <div class="cell obs"><span class="lbl">observed</span>${escapeHtml(entry.state)}</div>
        <div class="cell dec"><span class="lbl">decided</span>${escapeHtml(entry.decision)}</div>
        <div class="cell app"><span class="lbl">applied</span>${escapeHtml(entry.applied)}</div>
      `;
      trail.append(row); // newest appended last; CSS column-reverse shows newest on top
      while (trail.children.length > MAX_ROWS) trail.firstElementChild?.remove();
      dot.classList.replace('dot-idle', 'dot-live');
      status.textContent = 'acting';
    },
    setStatus(text: string, live: boolean): void {
      dot.classList.toggle('dot-live', live);
      dot.classList.toggle('dot-idle', !live);
      status.textContent = text;
    },
    rowText(i: number): string | null {
      // i = 0 is the NEWEST row (container is displayed column-reverse)
      const n = trail.children.length;
      return (trail.children[n - 1 - i] as HTMLElement | undefined)?.textContent ?? null;
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
}