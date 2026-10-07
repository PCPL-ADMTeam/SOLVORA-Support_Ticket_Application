// Design tokens for the Solvora Assistant. They are exposed as CSS custom
// properties (--sv-*) on one wrapper element, so every chat component styles
// itself with `var(--sv-…)` and light/dark + role accents are a single switch.
//
// The role only picks a COLOR THEME. It is cosmetic: it is never sent to the
// server and never decides what the assistant may do (the server derives
// permissions from the authenticated session).

export const BRAND_RED = "#C62828";
export const LAUNCHER_GRADIENT = "linear-gradient(135deg, #C62828 0%, #E53935 100%)";

// accent: fills with white text (all pairs >= 4.5:1).
// ink: accent used as TEXT/ICON on the surface (light / dark variants).
// soft: tinted background for chips and icon tiles.
const ROLE_ACCENTS = {
  ADMIN: { accent: "#C62828", gradient: ["#B71C1C", "#D32F2F"], ink: ["#B71C1C", "#FF9E9A"], soft: ["#FDECEC", "rgba(239,83,80,0.16)"] },
  MANAGER: { accent: "#1D4ED8", gradient: ["#1E40AF", "#2563EB"], ink: ["#1D4ED8", "#93C5FD"], soft: ["#EAF1FE", "rgba(96,165,250,0.16)"] },
  TEAMLEAD: { accent: "#6D28D9", gradient: ["#5B21B6", "#7C3AED"], ink: ["#6D28D9", "#C4B5FD"], soft: ["#F2EBFE", "rgba(167,139,250,0.16)"] },
  EMPLOYEE: { accent: "#15803D", gradient: ["#166534", "#15803D"], ink: ["#15803D", "#86EFAC"], soft: ["#E7F6EC", "rgba(74,222,128,0.14)"] },
};

const SURFACES = {
  light: {
    bg: "#F7F8FA",
    surface: "#FFFFFF",
    border: "#E5E7EB",
    text: "#111827",
    muted: "#6B7280", // 4.8:1 on #F7F8FA / 4.8:1 on white
    success: "#15803D",
    warning: "#B45309",
    error: "#DC2626",
    shadow: "0 24px 60px rgba(0,0,0,0.18)",
    cardShadow: "0 1px 2px rgba(17,24,39,0.06)",
    cardShadowHover: "0 6px 16px rgba(17,24,39,0.10)",
  },
  dark: {
    bg: "#0F1115",
    surface: "#171A21",
    border: "#2A2F3A",
    text: "#F3F4F6",
    muted: "#A0A7B4",
    success: "#4ADE80",
    warning: "#FBBF24",
    error: "#F87171",
    shadow: "0 24px 60px rgba(0,0,0,0.6)",
    cardShadow: "0 1px 2px rgba(0,0,0,0.4)",
    cardShadowHover: "0 6px 16px rgba(0,0,0,0.5)",
  },
};

export const ROLE_LABELS = { ADMIN: "Admin", MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee" };

export function accentFor(role) {
  return ROLE_ACCENTS[role] || ROLE_ACCENTS.ADMIN;
}

export function chatThemeVars(mode = "light", role) {
  const m = mode === "dark" ? 1 : 0;
  const s = SURFACES[mode === "dark" ? "dark" : "light"];
  const a = accentFor(role);
  return {
    "--sv-accent": a.accent,
    "--sv-accent-ink": a.ink[m],
    "--sv-accent-soft": a.soft[m],
    "--sv-accent-gradient": `linear-gradient(135deg, ${a.gradient[0]} 0%, ${a.gradient[1]} 100%)`,
    "--sv-on-accent": "#FFFFFF",
    "--sv-bg": s.bg,
    "--sv-surface": s.surface,
    "--sv-border": s.border,
    "--sv-text": s.text,
    "--sv-muted": s.muted,
    "--sv-success": s.success,
    "--sv-warning": s.warning,
    "--sv-error": s.error,
    "--sv-shadow": s.shadow,
    "--sv-card-shadow": s.cardShadow,
    "--sv-card-shadow-hover": s.cardShadowHover,
    "--sv-focus": a.ink[m],
    "--sv-radius-window": "24px",
    "--sv-radius-card": "16px",
    "--sv-radius-bubble": "18px",
    "--sv-fast": "150ms",
    "--sv-base": "200ms",
    "--sv-slow": "250ms",
  };
}
