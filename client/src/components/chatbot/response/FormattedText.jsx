import { Box, Typography } from "@mui/material";

// Plain answer text, laid out for reading: blank lines separate paragraphs, "• " / "- " lines become a
// bullet list (indented lines a nested level), "1. " lines a numbered list, and a short line ending in
// ":" just before a list is its heading. Everything is rendered as React text, never as HTML, so
// nothing in a message (ticket titles, names, user input) can inject markup.

const BULLET = /^(\s*)[•\-*]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;

function parse(text) {
  const blocks = [];
  let para = null;
  const closePara = () => {
    if (para) blocks.push({ type: "p", lines: para });
    para = null;
  };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const bullet = line.match(BULLET);
    const numbered = !bullet && line.match(NUMBERED);
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      closePara();
      blocks.push({ type: "gap" });
    } else if (bullet) {
      closePara();
      const item = { text: bullet[2], depth: bullet[1].length >= 2 ? 1 : 0 };
      if (last?.type === "ul") last.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
    } else if (numbered) {
      closePara();
      if (last?.type === "ol") last.items.push(numbered[2]);
      else blocks.push({ type: "ol", start: Number(numbered[1]), items: [numbered[2]] });
    } else if (/^\s{2,}\S/.test(line) && (last?.type === "ul" || last?.type === "ol") && !para) {
      // An indented continuation of the last list item.
      const items = last.items;
      if (last.type === "ul") items[items.length - 1] = { ...items[items.length - 1], text: `${items[items.length - 1].text} ${line.trim()}` };
      else items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    } else {
      if (!para) para = [];
      para.push(line.trim());
    }
  }
  closePara();
  // A paragraph made of one short line ending in ":" right before a list is that list's heading.
  return blocks
    .filter((b, i, all) => b.type !== "gap" || (i > 0 && i < all.length - 1))
    .map((b, i, all) => {
      const next = all[i + 1];
      if (b.type === "p" && b.lines.length === 1 && /:$/.test(b.lines[0]) && b.lines[0].length <= 80 && (next?.type === "ul" || next?.type === "ol")) return { type: "heading", text: b.lines[0] };
      return b;
    });
}

const body = { color: "var(--sv-text)", wordBreak: "break-word" };

export default function FormattedText({ text }) {
  const blocks = parse(text);
  return (
    <Box sx={{ "& > * + *": { mt: 0.75 } }}>
      {blocks.map((b, i) => {
        const key = `${b.type}-${i}`;
        if (b.type === "gap") return <Box key={key} aria-hidden sx={{ height: 2 }} />;
        if (b.type === "heading") {
          return (
            <Typography key={key} variant="body2" fontWeight={700} sx={body}>
              {b.text}
            </Typography>
          );
        }
        if (b.type === "ul") {
          return (
            <Box key={key} component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.35 }}>
              {b.items.map((item, j) => (
                <Typography key={j} component="li" variant="body2" sx={{ ...body, ml: item.depth ? 2 : 0, listStyleType: item.depth ? "circle" : "disc" }}>
                  {item.text}
                </Typography>
              ))}
            </Box>
          );
        }
        if (b.type === "ol") {
          return (
            <Box key={key} component="ol" start={b.start} sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.35 }}>
              {b.items.map((item, j) => (
                <Typography key={j} component="li" variant="body2" sx={body}>
                  {item}
                </Typography>
              ))}
            </Box>
          );
        }
        return (
          <Typography key={key} variant="body2" sx={{ ...body, whiteSpace: "pre-line" }}>
            {b.lines.join("\n")}
          </Typography>
        );
      })}
    </Box>
  );
}
