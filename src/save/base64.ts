// Text to base64 and back, as UTF-8. Used by the text code and by the cloud backup, which sends a file's text so.

export const toBase64 = (text: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Throws on anything that is not base64 of valid UTF-8. */
export const fromBase64 = (code: string): string => {
  const binary = atob(code);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};
