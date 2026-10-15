// Inline text diff for Activity History's "Comment edited" entries.
//
// Word-level LCS over tokens that keep EVERY character of the input (word
// runs, whitespace runs — spaces, tabs, newlines — and single punctuation
// marks), so joining the parts of one side reproduces that text exactly.
// A removed word directly followed by an added word (e.g. "inline" ->
// "outline") is refined at character level by trimming their common prefix
// and suffix. If the two texts share no word/punctuation token at all, the
// result is flagged as a full replacement.

const TOKEN_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
// Beyond this many token comparisons the texts are shown as a full
// replacement rather than spending a long time on the LCS table.
const MAX_CELLS = 4_000_000;

function tokenize(text) {
  return text.match(TOKEN_RE) || [];
}

function pushPart(parts, type, text) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.type === type) last.text += text;
  else parts.push({ type, text });
}

// Splits a single-word del/ins pair into shared prefix/suffix + changed middle.
function refineWordPair(parts, delText, insText) {
  let start = 0;
  while (start < delText.length && start < insText.length && delText[start] === insText[start]) start += 1;
  let end = 0;
  while (
    end < delText.length - start &&
    end < insText.length - start &&
    delText[delText.length - 1 - end] === insText[insText.length - 1 - end]
  ) end += 1;
  pushPart(parts, "same", delText.slice(0, start));
  pushPart(parts, "del", delText.slice(start, delText.length - end));
  pushPart(parts, "ins", insText.slice(start, insText.length - end));
  pushPart(parts, "same", delText.slice(delText.length - end));
}

/**
 * @returns {{ parts: {type: "same"|"del"|"ins", text: string}[], fullReplacement: boolean }}
 */
export function diffText(oldText = "", newText = "") {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (!a.length || !b.length || a.length * b.length > MAX_CELLS) {
    return { parts: [], fullReplacement: true };
  }

  // LCS lengths, suffix-based so the walk below goes front to back.
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      ops.push({ type: "ins", text: b[j] });
      j += 1;
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "ins", text: b[j++] });

  // Nothing but whitespace in common => show as a full replacement.
  const sharesContent = ops.some((op) => op.type === "same" && /\S/.test(op.text));
  if (!sharesContent) return { parts: [], fullReplacement: true };

  // Merge runs; refine an adjacent single-word del+ins pair character-wise.
  const merged = [];
  ops.forEach((op) => pushPart(merged, op.type, op.text));
  const parts = [];
  for (let k = 0; k < merged.length; k += 1) {
    const cur = merged[k];
    const next = merged[k + 1];
    const isWord = (t) => /^[\p{L}\p{N}_]+$/u.test(t);
    if (cur.type === "del" && next?.type === "ins" && isWord(cur.text) && isWord(next.text)) {
      refineWordPair(parts, cur.text, next.text);
      k += 1;
    } else {
      pushPart(parts, cur.type, cur.text);
    }
  }
  return { parts, fullReplacement: false };
}

// Comment bodies are stored sanitized (HTML-escaped / simple HTML); show
// their visible text. textContent keeps whitespace and never executes or
// injects markup — the result is rendered as React text.
export function commentHtmlToText(html) {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}
