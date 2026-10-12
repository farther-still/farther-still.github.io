// Browser features that do not exist everywhere the game runs. On the plain-HTTP LAN dev server
// `navigator.storage`, `navigator.share`, `navigator.clipboard` and `navigator.serviceWorker` are all missing,
// so every use is feature-tested first (ARCHITECTURE section 9).

export type PersistStatus = 'granted' | 'denied' | 'unsupported' | 'error';

/** Asked at launch and shown in Settings. Nothing relies on the answer. */
export const requestPersistence = async (nav: Navigator): Promise<PersistStatus> => {
  const storage = (nav as { storage?: Partial<StorageManager> }).storage;
  if (storage === undefined || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'error';
  }
};

/** True when launched from the Home Screen icon. Safari and the installed app do not share storage. */
export const isStandalone = (win: Window): boolean => {
  const legacy = (win.navigator as { standalone?: boolean }).standalone === true;
  return legacy || win.matchMedia('(display-mode: standalone)').matches;
};

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

// Browsers differ in which file types the share sheet takes. JSON is tried first, then plain text, which is
// what the file is anyway.
const SHARE_TYPES = ['application/json', 'text/plain'];

const shareableFile = (nav: Navigator, name: string, text: string): File | null => {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return null;
  for (const type of SHARE_TYPES) {
    try {
      const file = new File([text], name, { type });
      if (nav.canShare({ files: [file] })) return file;
    } catch {
      // This type is not accepted here; try the next.
    }
  }
  return null;
};

export const canShareFile = (nav: Navigator, name: string, text: string): boolean => shareableFile(nav, name, text) !== null;

/**
 * Opens the share sheet with one JSON file. Must be called directly from a tap: Safari refuses a share that
 * does not start inside the gesture, so the text is prepared before the button is shown.
 */
export const shareTextFile = async (nav: Navigator, name: string, text: string): Promise<ShareOutcome> => {
  const file = shareableFile(nav, name, text);
  if (file === null) return 'unsupported';
  try {
    await nav.share({ files: [file], title: name });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
};

export const copyText = async (nav: Navigator, text: string): Promise<boolean> => {
  const clipboard = (nav as { clipboard?: Partial<Clipboard> }).clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/** The laptop's way to save a file where there is no share sheet. */
export const downloadTextFile = (doc: Document, name: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  doc.body.append(link);
  link.click();
  link.remove();
  // The download reads the URL after the click returns, so it is released later, not at once.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};
