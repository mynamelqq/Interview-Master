/** Repair Markdown that was escaped again inside an AI JSON string. */
export function normalizeMarkdown(value: string | null | undefined, prose = false): string {
  if (!value) return "";
  const source = value.replace(/\r\n?/g, "\n");
  const escapedBreaks = (source.match(/\\n/g) || []).length;
  const realBreaks = (source.match(/\n/g) || []).length;
  // Preserve literal escape sequences in code and already well-formed Markdown.
  const likelyEscapedProse = escapedBreaks > 0 && realBreaks === 0 && source.length > 24;
  const repaired = !likelyEscapedProse && (escapedBreaks < 2 || realBreaks >= escapedBreaks)
    ? source : source.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t");
  if (!prose) return repaired;
  const fencedText = repaired.trim().match(/^```(?:text|plaintext)\s*\n([\s\S]*?)\n```$/i);
  if (fencedText && /[\u4e00-\u9fff]{6,}/.test(fencedText[1])) return fencedText[1].trim();
  return repaired.replace(/^text\n(?=[\u4e00-\u9fff])/, "");
}
