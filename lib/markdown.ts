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
  return repairCjkEmphasis(repaired.replace(/^text\n(?=[\u4e00-\u9fff])/, ""));
}

function repairCjkEmphasis(source: string): string {
  let fenceMarker = "";
  let fenceLength = 0;
  return source.split("\n").map(line => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!fenceMarker) { fenceMarker = fence[1][0]; fenceLength = fence[1].length; }
      else if (fence[1][0] === fenceMarker && fence[1].length >= fenceLength) fenceMarker = "";
      return line;
    }
    if (fenceMarker) return line;
    return line.split(/(`[^`\n]*`)/g).map((part, index) => index % 2 ? part : part.replace(/(\*\*[^*\n]+[。！？；，、：])\*\*(?=[\u3400-\u9fff])/g, "$1**\u2009")).join("");
  }).join("\n");
}
