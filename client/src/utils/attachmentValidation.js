// Shared attachment-selection validation for the Raise/Edit Ticket form —
// used identically whether files arrive via the "Upload File" input or a
// Ctrl+V clipboard image paste (see TicketForm.jsx/RichTextField.jsx), so
// neither path can bypass the other's rules and a pasted screenshot counts
// toward the exact same caps as an uploaded file. Mirrors
// ticket.service.js's MAX_ATTACHMENTS_PER_TICKET/MAX_ATTACHMENTS_TOTAL_SIZE_MB
// exactly — a UX convenience only; the backend remains the authoritative,
// unbypassable check regardless of what this allows through.
export const MAX_ATTACHMENT_MB = 10;
export const MAX_ATTACHMENTS_PER_TICKET = 5;
export const MAX_ATTACHMENTS_TOTAL_SIZE_MB = 10;
export const MAX_ATTACHMENTS_TOTAL_SIZE_BYTES = MAX_ATTACHMENTS_TOTAL_SIZE_MB * 1024 * 1024;

// Returns { validFiles, error } — never throws. The count/combined-size caps
// reject the WHOLE incoming batch at once (never a silent partial add, so a
// user picking too many files gets a clear rejection instead of "however
// many happened to fit"); a per-file size violation instead skips just that
// one file, same as the original "Upload File"-only behavior this replaces.
export function validateNewAttachments(incomingFiles, { remainingSlots, remainingBytes }) {
  if (!incomingFiles.length) return { validFiles: [], error: "" };

  if (incomingFiles.length > remainingSlots) {
    return {
      validFiles: [],
      error: `Maximum ${MAX_ATTACHMENTS_PER_TICKET} attachments are allowed per ticket. You can upload only ${remainingSlots} more file(s).`,
    };
  }

  const incomingSize = incomingFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  if (incomingSize > remainingBytes) {
    return {
      validFiles: [],
      error: `Attachments cannot exceed ${MAX_ATTACHMENTS_TOTAL_SIZE_MB} MB combined per ticket. Only ${(remainingBytes / (1024 * 1024)).toFixed(1)} MB more can be uploaded.`,
    };
  }

  const validFiles = [];
  let error = "";
  for (const file of incomingFiles) {
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      error = `Files must be under ${MAX_ATTACHMENT_MB} MB.`;
      continue;
    }
    validFiles.push(file);
  }

  return { validFiles, error };
}
