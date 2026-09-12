import { el } from './dom.js';
import { t, ui } from './i18n.js';
import PhotoSwipe from 'photoswipe';

let activeViewer: PhotoSwipe | null = null;

export interface RecordedArtifact {
  id: string;
  name: string;
  mimeType: string;
  bytes?: number;
  state?: 'available' | 'generating' | 'unavailable' | 'expired' | 'failed';
}

export interface ArtifactActions {
  /** Only read a recorded local asset through the validated main-process API. */
  loadImage?: () => Promise<string | null>;
  /** True means the main process confirmed publication; false is a cancelled save dialog. */
  save?: () => Promise<boolean>;
  openSource?: () => Promise<unknown>;
  /** Exact session/selection generation fence, supplied by the owning transcript. */
  current: () => boolean;
}

/** Reject remote/signed URLs and executable image formats at the display boundary too. */
export function isRecordedImageData(value: string): boolean {
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** No network requests, invented progress, or automatic image regeneration. */
export function artifactCard(artifact: RecordedArtifact, actions: ArtifactActions): HTMLElement {
  const card = el('article', 'artifact-card');
  card.dataset.assetId = artifact.id;
  const imageType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(artifact.mimeType);
  const state = artifact.state ?? 'available';
  card.dataset.state = state;
  const title = el('strong', 'artifact-name', artifact.name);
  const status = el('p', 'artifact-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const controls = el('div', 'artifact-actions');
  const footer = el('div', 'artifact-footer'); footer.append(title, controls);
  card.append(footer, status);
  const current = () => card.isConnected && actions.current();
  let loading = false, dataUrl: string | null = null, viewer: PhotoSwipe | null = null;
  let imageWidth = 0, imageHeight = 0;
  let dialogSaveStatus: HTMLElement | null = null;
  const saveStatus = el('p', 'artifact-status artifact-save-status');
  saveStatus.hidden = true; saveStatus.setAttribute('role', 'status'); card.append(saveStatus);

  function message(read: () => string, error = false): void {
    status.hidden = false;
    ui(status, 'textContent', read);
    status.dataset.tone = error ? 'error' : 'normal';
  }
  function button(label: () => string, className: string, action: () => void): HTMLButtonElement {
    const node = el('button', `btn ${className}`, label) as HTMLButtonElement;
    node.type = 'button'; node.onclick = action; controls.append(node); return node;
  }

  const preview = imageType && actions.loadImage && state === 'available'
    ? button(() => t('View image'), 'artifact-preview', () => { void openPreview(); }) : null;
  if (preview) {
    card.classList.add('has-preview'); card.prepend(preview);
    ui(preview, 'aria-label', () => t('Image preview: {0}', [artifact.name]));
    ui(preview, 'title', () => t('View image'));
  }
  const save = actions.save && state === 'available'
    ? button(() => t('Save file'), 'artifact-save', () => { void saveFile(); }) : null;
  if (actions.openSource) button(() => t('Open original message'), 'artifact-source', () => {
    if (!current()) return;
    void actions.openSource!().catch(error => {
      if (current()) message(() => t('Could not open the original message: {0}', [errorText(error)]), true);
    });
  });
  // A quiet caption bar, with named icon controls; the image itself opens the viewer.
  if (preview) for (const [selector, label, pathData] of [
    ['.artifact-save', 'Save file', 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4'],
    ['.artifact-source', 'Open original message', 'M14 3h7v7m0-7L10 14M10 5H4v15h15v-6']
  ]) {
    const action = controls.querySelector<HTMLButtonElement>(selector!);
    if (!action) continue;
    ui(action, 'aria-label', () => t(label!)); ui(action, 'title', () => t(label!));
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('class', 'ico'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', pathData!); icon.append(path);
    const caption = el('span', 'sr-only', () => t(label!)); action.replaceChildren(icon, caption);
  }
  if (state === 'generating') message(() => t('Generating. Waiting for the provider to return the file.'));
  else if (state === 'expired') message(() => t('This file has expired. Open the original message to check availability.'), true);
  else if (state === 'unavailable') message(() => t('The file is not available locally. Open the original message to view it.'), true);
  else if (state === 'failed') message(() => t('File generation failed. Check the original message for details.'), true);
  else if (!preview && !save) message(() => t('No local preview is available. Open the original message to view this file.'));
  else message(() => t('Recorded file · {0}', [artifact.mimeType]));

  async function saveFile(): Promise<void> {
    if (!save || save.disabled || !current()) return;
    const report = (read: () => string, error = false) => {
      for (const node of [saveStatus, dialogSaveStatus]) if (node) {
        node.hidden = false; ui(node, 'textContent', read); node.dataset.tone = error ? 'error' : 'normal';
      }
    };
    save.disabled = true; report(() => t('Saving file…'));
    try {
      const saved = await actions.save!();
      if (current()) report(() => saved ? t('File saved') : t('Save cancelled'));
    } catch (error) {
      if (current()) report(() => t('File was not saved: {0}', [errorText(error)]), true);
    } finally { if (current()) save.disabled = false; }
  }

  async function load(): Promise<boolean> {
    if (!preview || loading || !current()) return false;
    if (dataUrl) return true;
    loading = true; preview.disabled = true; card.setAttribute('aria-busy', 'true');
    message(() => t('Loading preview…'));
    try {
      const data = await actions.loadImage!();
      if (!current()) return false;
      if (!data) {
        message(() => t('The recorded image is unavailable. Open the original message or retry loading the preview.'), true);
        return false;
      }
      if (!isRecordedImageData(data)) throw new Error(t('The recorded image format is not supported.'));
      const image = document.createElement('img'); image.src = data; image.alt = artifact.name;
      await image.decode();
      if (!current()) return false;
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(t('The recorded image format is not supported.'));
      imageWidth = image.naturalWidth; imageHeight = image.naturalHeight; dataUrl = data;
      card.style.setProperty('--preview-width', `${Math.max(180, Math.min(320, imageWidth, imageWidth * 180 / imageHeight))}px`);
      image.className = 'artifact-thumbnail'; image.loading = 'lazy';
      image.addEventListener('error', () => {
        if (!current()) return;
        dataUrl = null; image.remove();
        preview.replaceChildren(el('span', '', () => t('View image')));
        message(() => t('The image could not be displayed. The recorded file has not been regenerated.'), true);
      }, { once: true });
      preview.replaceChildren(image);
      message(() => t('Preview ready'));
      status.hidden = true;
      return true;
    } catch (error) {
      if (current()) message(() => t('Preview could not be loaded: {0}', [errorText(error)]), true);
      return false;
    } finally {
      loading = false;
      if (current()) { preview.disabled = false; card.setAttribute('aria-busy', 'false'); }
    }
  }

  async function openPreview(): Promise<void> {
    if (!await load() || !current() || !dataUrl || viewer) return;
    if (activeViewer) { activeViewer.options.returnFocus = false; activeViewer.destroy(); }
    const reduced = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    preview?.focus();
    const gallery = new PhotoSwipe({
      dataSource: [{ src: dataUrl, width: imageWidth, height: imageHeight, alt: artifact.name }],
      index: 0, mainClass: 'artifact-gallery', bgOpacity: .94, wheelToZoom: true,
      escKey: true, trapFocus: true, returnFocus: true, loop: false,
      showHideAnimationType: 'none', zoomAnimationDuration: reduced ? 0 : 180,
      closeTitle: t('Close'), zoomTitle: t('Zoom image'),
      errorMsg: t('The image could not be displayed. The recorded file has not been regenerated.')
    });
    viewer = gallery; activeViewer = gallery;
    const observer = new MutationObserver(() => {
      if (!current()) { gallery.options.returnFocus = false; gallery.destroy(); }
    });
    gallery.on('uiRegister', () => {
      gallery.ui?.registerElement({ name: 'artifact-title', order: 1, appendTo: 'bar',
        onInit: element => { element.textContent = artifact.name; } });
      if (save) gallery.ui?.registerElement({ name: 'artifact-save', order: 8, isButton: true,
        title: t('Save file'), onInit: element => { ui(element, 'textContent', () => t('Save file')); },
        onClick: () => { void saveFile(); } });
      gallery.ui?.registerElement({ name: 'artifact-save-status', appendTo: 'root',
        onInit: element => { dialogSaveStatus = element; element.setAttribute('role', 'status'); element.hidden = true; } });
    });
    gallery.on('afterInit', () => {
      if (gallery.element) ui(gallery.element, 'aria-label', () => t('Image preview: {0}', [artifact.name]));
      observer.observe(document.body, { childList: true, subtree: true });
    });
    gallery.on('destroy', () => {
      observer.disconnect(); viewer = null; dialogSaveStatus = null;
      if (activeViewer === gallery) activeViewer = null;
    });
    gallery.on('loadComplete', event => {
      if (event.isError && current()) message(() => t('The image could not be displayed. The recorded file has not been regenerated.'), true);
    });
    gallery.init();
  }

  // Local thumbnails only. A detached card or stale session cannot publish the read result.
  if (preview) queueMicrotask(() => { if (current()) void load(); });
  return card;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : t('Operation failed. Please try again.');
}
