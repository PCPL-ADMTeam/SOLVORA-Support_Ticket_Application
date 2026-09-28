import { useEffect, useRef } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { Box, Typography } from "@mui/material";

// Only the formatting the Problem Summary field is required to support —
// deliberately NO image/link/color/header controls, so nothing in this
// toolbar can insert an image into the content itself (that's the whole
// point of Feature 1: a pasted screenshot becomes an attachment, never
// inline content).
const TOOLBAR_MODULES = {
  toolbar: [["bold", "italic", "underline"], [{ list: "ordered" }, { list: "bullet" }]],
};
const FORMATS = ["bold", "italic", "underline", "list", "bullet"];

const TOOLBAR_BUTTON_LABELS = [
  { selector: "button.ql-bold", label: "Bold" },
  { selector: "button.ql-italic", label: "Italic" },
  { selector: "button.ql-underline", label: "Underline" },
  { selector: "button.ql-list[value='ordered']", label: "Numbered list" },
  { selector: "button.ql-list[value='bullet']", label: "Bullet list" },
];

// Rich-text Problem Summary editor (Quill, already an existing project
// dependency — see main.jsx's StrictMode note, left in place from when the
// old ticket Description field used it). The HTML this produces is
// sanitized server-side before being persisted (see
// ticket.service.js#createTicket's sanitizeRichText); `onChange`'s second
// argument is the CURRENT VISIBLE TEXT ONLY (Quill's own getText()), so a
// caller doing the 50-word count never has to parse HTML itself.
//
// `error` doubles as both the boolean "show the error state" flag and the
// message text itself — pass the validation message string (or "" / null
// when valid), matching how every other field in this form reports errors.
//
// `onImagePaste` is the Feature 1 hook: a capture-phase `paste` listener on
// Quill's own root element runs BEFORE Quill's internal (bubble-phase)
// paste handler ever sees the event, so `preventDefault` +
// `stopImmediatePropagation` here fully stops Quill from ever inserting a
// pasted image into the content — normal text paste is completely
// unaffected (the listener returns immediately, doing nothing, whenever the
// clipboard has no image item).
export default function RichTextField({ value, onChange, onImagePaste, placeholder, error }) {
  const quillRef = useRef(null);
  const wrapperRef = useRef(null);
  const onImagePasteRef = useRef(onImagePaste);
  onImagePasteRef.current = onImagePaste;

  useEffect(() => {
    const editor = quillRef.current?.getEditor();
    const root = editor?.root;
    if (!root) return undefined;

    const handlePaste = (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItems = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
      if (!imageItems.length) return; // no image on the clipboard — let Quill paste text normally

      event.preventDefault();
      event.stopImmediatePropagation();

      const files = imageItems
        .map((item, i) => {
          const blob = item.getAsFile();
          if (!blob) return null;
          const ext = (item.type.split("/")[1] || "png").split("+")[0];
          const suffix = imageItems.length > 1 ? `-${i + 1}` : "";
          return new File([blob], `pasted-image-${Date.now()}${suffix}.${ext}`, { type: item.type });
        })
        .filter(Boolean);

      onImagePasteRef.current?.(files);
    };

    root.addEventListener("paste", handlePaste, true);
    return () => root.removeEventListener("paste", handlePaste, true);
  }, []);

  // Quill's toolbar buttons carry no text/aria-label of their own (they're
  // pure CSS icon buttons) — label them once after mount for screen readers
  // and mouse-hover tooltips alike.
  useEffect(() => {
    const toolbar = wrapperRef.current?.querySelector(".ql-toolbar");
    if (!toolbar) return;
    for (const { selector, label } of TOOLBAR_BUTTON_LABELS) {
      const button = toolbar.querySelector(selector);
      if (button) {
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
      }
    }
  }, []);

  const handleChange = (html, _delta, _source, editor) => {
    onChange(html, editor.getText());
  };

  return (
    <Box
      ref={wrapperRef}
      sx={{
        "& .ql-toolbar.ql-snow": {
          borderColor: error ? "error.main" : "divider",
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
          fontFamily: "inherit",
        },
        "& .ql-container.ql-snow": {
          borderColor: error ? "error.main" : "divider",
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
          fontFamily: "inherit",
          fontSize: 14,
        },
        "& .ql-editor": {
          minHeight: 110,
        },
        "& .ql-editor.ql-blank::before": {
          fontStyle: "normal",
          color: "text.disabled",
        },
      }}
    >
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={handleChange}
        modules={TOOLBAR_MODULES}
        formats={FORMATS}
        placeholder={placeholder}
      />
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 0.5, display: "block" }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
