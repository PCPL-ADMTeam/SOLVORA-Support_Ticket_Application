import { keyframes } from "@mui/material/styles";

export const rise = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;
export const popIn = keyframes`from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: none; }`;
export const bounce = keyframes`0%,100% { transform: translateY(0); } 30% { transform: translateY(-10px); } 55% { transform: translateY(0); } 75% { transform: translateY(-4px); }`;
export const dot = keyframes`0%,80%,100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); }`;
export const glow = keyframes`0%,100% { box-shadow: 0 8px 24px rgba(198,40,40,0.38), 0 0 0 0 rgba(229,57,53,0.35); } 50% { box-shadow: 0 8px 24px rgba(198,40,40,0.38), 0 0 0 10px rgba(229,57,53,0); }`;

export const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

// Animations are decoration only: switched off for users who ask for less motion.
export const reducedMotion = { "@media (prefers-reduced-motion: reduce)": { animation: "none !important", transition: "none !important" } };

export const focusRing = {
  "&:focus-visible": { outline: "2px solid var(--sv-focus)", outlineOffset: 2 },
};

// A raised card on the chat background.
export const card = {
  bgcolor: "var(--sv-surface)",
  color: "var(--sv-text)",
  border: "1px solid var(--sv-border)",
  borderRadius: "var(--sv-radius-card)",
  boxShadow: "var(--sv-card-shadow)",
};

// Cards that can be pressed: lift on hover, ring on keyboard focus.
export const interactiveCard = {
  ...card,
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
  transition: "transform var(--sv-fast) ease, box-shadow var(--sv-fast) ease, border-color var(--sv-fast) ease",
  "&:hover:not(:disabled)": { transform: "translateY(-2px)", boxShadow: "var(--sv-card-shadow-hover)", borderColor: "var(--sv-accent-ink)" },
  "&:active:not(:disabled)": { transform: "translateY(0)" },
  "&:disabled": { opacity: 0.55, cursor: "default" },
  ...focusRing,
  ...reducedMotion,
};
