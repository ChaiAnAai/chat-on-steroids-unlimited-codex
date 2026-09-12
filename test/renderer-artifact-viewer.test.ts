import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { artifactCard, isRecordedImageData } from '../src/renderer/artifact-viewer.js';

const imageData = 'data:image/png;base64,aGVsbG8=';
const artifact = { id: 'abcdef12.png', name: '<script>Generated image</script>', mimeType: 'image/png' };
let dom: JSDOM;
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
beforeEach(() => {
  dom = new JSDOM('<main></main>', { url: 'https://local.test', pretendToBeVisual: true });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('Element', dom.window.Element);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('HTMLImageElement', dom.window.HTMLImageElement);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  Object.defineProperty(dom.window.document.documentElement, 'clientWidth', { value: 1024, configurable: true });
  dom.window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
  // jsdom cannot decode pixels. Only this native boundary is stubbed; PhotoSwipe is real.
  dom.window.HTMLImageElement.prototype.decode = vi.fn(async () => {});
  Object.defineProperty(dom.window.HTMLImageElement.prototype, 'naturalWidth', { get: () => 1600, configurable: true });
  Object.defineProperty(dom.window.HTMLImageElement.prototype, 'naturalHeight', { get: () => 1200, configurable: true });
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('admits only local bounded-format image data, never remote or executable previews', () => {
  expect(isRecordedImageData(imageData)).toBe(true);
  for (const value of ['https://chatgpt.com/signed-file', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,aGVsbG8='])
    expect(isRecordedImageData(value)).toBe(false);
});

it('opens the actual PhotoSwipe component and restores focus after its Escape handler', async () => {
  const loadImage = vi.fn(async () => imageData);
  const card = artifactCard(artifact, { loadImage, current: () => true });
  document.body.append(card); await flush();
  expect(loadImage).toHaveBeenCalledOnce();
  expect(card.querySelector('script')).toBeNull();
  expect(card.querySelector('img')?.src).toBe(imageData);
  const preview = card.querySelector<HTMLButtonElement>('.artifact-preview')!;
  expect(preview.textContent).toBe('');
  expect(preview.getAttribute('aria-label')).toContain(artifact.name);
  expect(card.querySelector<HTMLElement>('.artifact-status')!.hidden).toBe(true);
  preview.focus(); preview.click(); await flush();
  const dialog = document.querySelector('.pswp')!;
  expect(dialog.getAttribute('role')).toBe('dialog');
  expect(dialog.querySelector('.pswp__button--zoom')).not.toBeNull();
  expect(dialog.querySelector('img.pswp__img')?.getAttribute('src')).toBe(imageData);
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('.pswp')).toBeNull());
  expect(document.activeElement).toBe(preview);
  expect(loadImage).toHaveBeenCalledOnce();
  card.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
  expect(card.querySelector<HTMLElement>('.artifact-status')!.hidden).toBe(false);
  expect(card.querySelector('.artifact-status')!.textContent).toContain('could not be displayed');
  expect(preview.textContent).toBe('View image');
});

it('leaves unavailable previews recoverable and reports a retry failure inline', async () => {
  const loadImage = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Read failed'));
  const card = artifactCard(artifact, { loadImage, current: () => true });
  document.body.append(card); await flush();
  expect(card.textContent).toContain('recorded image is unavailable');
  card.querySelector<HTMLButtonElement>('.artifact-preview')!.click(); await flush();
  expect(card.textContent).toContain('Read failed');
  expect(card.querySelector<HTMLButtonElement>('.artifact-preview')!.disabled).toBe(false);
  expect(document.querySelector('.pswp')).toBeNull();
});

it('publishes save success only from confirmation and keeps failure and cancellation distinct', async () => {
  let confirm!: (value: boolean) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve; }))
    .mockRejectedValueOnce(new Error('Disk full')).mockResolvedValueOnce(false);
  const card = artifactCard({ ...artifact, mimeType: 'application/pdf' }, { save, current: () => true });
  document.body.append(card);
  const button = card.querySelector<HTMLButtonElement>('.artifact-save')!;
  button.click(); button.click();
  expect(save).toHaveBeenCalledOnce(); expect(button.disabled).toBe(true);
  expect(card.textContent).toContain('Saving file'); expect(card.textContent).not.toContain('File saved');
  confirm(true); await flush(); expect(card.textContent).toContain('File saved');
  button.click(); await flush(); expect(card.textContent).toContain('Disk full');
  button.click(); await flush(); expect(card.textContent).toContain('Save cancelled');
});

it('fences a delayed read after session navigation and closes an open preview when detached', async () => {
  let publish!: (value: string) => void, selected = true;
  const card = artifactCard(artifact, { loadImage: () => new Promise(resolve => { publish = resolve; }), current: () => selected });
  document.body.append(card); await flush(); selected = false; publish(imageData); await flush();
  expect(card.querySelector('img')).toBeNull();
  expect(document.querySelector('.pswp')).toBeNull();
  const replacement = artifactCard(artifact, { loadImage: async () => imageData, current: () => true });
  document.body.append(replacement); await flush();
  replacement.querySelector<HTMLButtonElement>('.artifact-preview')!.click(); await flush();
  expect(document.querySelector('.pswp')).not.toBeNull();
  replacement.remove(); await vi.waitFor(() => expect(document.querySelector('.pswp')).toBeNull());
});

it('does not erase a save failure when an independent preview read completes', async () => {
  let publish!: (value: string) => void;
  const card = artifactCard(artifact, { loadImage: () => new Promise(resolve => { publish = resolve; }),
    save: async () => { throw new Error('Disk full'); }, current: () => true });
  document.body.append(card); await flush();
  card.querySelector<HTMLButtonElement>('.artifact-save')!.click(); await flush();
  publish(imageData); await flush();
  expect(card.textContent).toContain('Preview ready');
  expect(card.querySelector('.artifact-save-status')?.textContent).toContain('Disk full');
});

it('shows provider states without silently loading, saving, or regenerating unavailable files', async () => {
  for (const state of ['generating', 'expired', 'unavailable', 'failed'] as const) {
    const loadImage = vi.fn(), save = vi.fn();
    const card = artifactCard({ ...artifact, state }, { loadImage, save, current: () => true });
    document.body.append(card); await flush();
    expect(card.dataset.state).toBe(state);
    expect(card.querySelector('.artifact-preview')).toBeNull();
    expect(card.querySelector('.artifact-save')).toBeNull();
    expect(loadImage).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  }
});
