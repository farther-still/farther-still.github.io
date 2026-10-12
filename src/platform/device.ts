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

/** What the page is told about the screen it is on, in points. Read at launch and on a resize; Settings shows it. */
export type ScreenReading = {
  standalone: boolean;
  portrait: boolean;
  /** The whole screen. */
  screenHeight: number;
  /** The page, as the browser lays it out. */
  pageHeight: number;
  insetTop: number;
  insetBottom: number;
};

const points = (value: unknown): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(number) ? Math.round(number) : 0;
};

/**
 * `probe` is an element padded at the top and bottom by the safe-area insets, which is the only way a script
 * can read them. Whatever a browser does not report reads as 0, and a reading of zeros changes nothing.
 */
export const readScreen = (win: Window, probe: Element | null): ScreenReading => {
  const view = win as { innerHeight?: unknown; innerWidth?: unknown; screen?: { height?: unknown }; getComputedStyle?: (of: Element) => { paddingTop?: unknown; paddingBottom?: unknown } };
  const padding = probe !== null && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(probe) : null;
  const pageHeight = points(view.innerHeight);
  return {
    standalone: isStandalone(win),
    portrait: pageHeight >= points(view.innerWidth),
    screenHeight: points(view.screen?.height),
    pageHeight,
    insetTop: points(padding?.paddingTop),
    insetBottom: points(padding?.paddingBottom),
  };
};

/**
 * True when the installed app's page ends above the bottom of the screen by the height of the status bar while
 * still being laid out under that bar. iOS has done this to Home Screen web apps on and off since 26.1 (WebKit
 * bug 301994): the page loses a band at the bottom that it cannot be relied on to draw in. The home bar lies
 * inside that band, so the room the page keeps clear for it is room kept twice (ARCHITECTURE A-32).
 *
 * It answers only to that exact shape. A page pushed down below an opaque status bar reports no top inset and
 * does reach the bottom of the screen, so it is not one.
 */
export const bandBelow = (screen: ScreenReading): boolean => {
  const band = screen.screenHeight - screen.pageHeight;
  return screen.standalone && screen.portrait && screen.insetTop > 0 && Math.abs(band - screen.insetTop) <= 1 && band >= screen.insetBottom;
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
