// Shared across every MUI <Dialog> in the app: wraps an existing onClose
// handler so a backdrop click is ignored (MUI passes `reason ===
// "backdropClick"` for that specific case) while every other close path —
// the X button, a Cancel button, Escape — still calls the handler exactly
// as before. Never changes what the handler itself does, only when it's
// invoked.
export function ignoreBackdropClick(handler) {
  return (event, reason) => {
    if (reason === "backdropClick") return;
    handler(event, reason);
  };
}
