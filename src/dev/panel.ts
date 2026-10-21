import { Pane } from 'tweakpane';
import type { FolderApi } from 'tweakpane';
import { resetTuning, tuning } from '../tuning';

/**
 * Dev tuning panel: live-edits every number in config/tuning.json and exports the result.
 * Open with ?dev in the URL or the ` key. Board, run, sprout and adapt values apply to the next garden.
 */
export function createPanel(opts: { onAudio: () => void; onNewGarden: () => void; seed: () => number | undefined }): Pane {
  const pane = new Pane({ title: 'Bloom tuning', expanded: true });
  const bindAll = (folder: FolderApi, obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') folder.addBinding(obj, key, { step: Number.isInteger(value) ? 1 : 0.01 });
      else if (Array.isArray(value)) {
        const sub = folder.addFolder({ title: key, expanded: false });
        value.forEach((_, i) => sub.addBinding(value as unknown as Record<string, number>, String(i), { label: `${key}[${i}]`, step: 0.01 }));
      }
    }
  };
  for (const [section, obj] of Object.entries(tuning)) {
    const folder = pane.addFolder({ title: section, expanded: section === 'feel' });
    bindAll(folder, obj as Record<string, unknown>);
  }
  pane.on('change', () => opts.onAudio());

  pane.addButton({ title: 'New garden with these values' }).on('click', opts.onNewGarden);
  pane.addButton({ title: 'Export tuning.json' }).on('click', () => {
    const json = JSON.stringify(tuning, null, 2) + '\n';
    void navigator.clipboard?.writeText(json).catch(() => {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'tuning.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  pane.addButton({ title: 'Reset to file values' }).on('click', () => {
    resetTuning();
    pane.refresh();
    opts.onAudio();
  });
  pane.addButton({ title: 'Copy seed of this garden' }).on('click', () => {
    void navigator.clipboard?.writeText(String(opts.seed() ?? ''));
  });
  return pane;
}
