import { createTheme } from "@mui/material/styles";

// Validated categorical palette (fixed hue order — never cycled/reassigned;
// see the dataviz skill's references/palette.md for the CVD-safety proof).
export const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

// Fixed good/warning/serious/critical steps — reserved for state, never
// reused as a plain series color.
export const STATUS_SCALE = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };

// The single vertical gap (an MUI `spacing` unit, i.e. × 8px) between a
// dashboard's KPI row and its charts below, used as the `spacing` prop on
// the `Stack` wrapping that section on every dashboard (Admin, Manager,
// Team Lead, Employee) so the gap reads as one consistent, intentional
// rhythm across roles instead of each dashboard picking its own value.
export const DASHBOARD_SECTION_SPACING = 3;

// Ticket workflow stages are mapped onto the categorical palette by fixed
// slot (identity, not severity) so badges/charts/legends all agree.
export const statusColors = {
  OPEN: { color: CATEGORICAL[0] },
  IN_PROGRESS: { color: CATEGORICAL[1] },
  ON_HOLD: { color: CATEGORICAL[3] },
  RESOLVED: { color: CATEGORICAL[5] },
  CLOSED: { color: "#898781" },
  REOPENED: { color: CATEGORICAL[7] },
};

export function buildTheme(mode) {
  const isDark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: { main: "#c81e2a", dark: "#991b25", light: "#fbe3e5", contrastText: "#ffffff" },
      secondary: { main: "#6b1f25", dark: "#461317", light: "#f7e8e9", contrastText: "#ffffff" },
      error: { main: "#c81e2a" },
      background:
        isDark
          ? { default: "#201518", paper: "#2a1b1f" }
          : { default: "#fff7f7", paper: "#ffffff" },
      divider: isDark ? "rgba(255, 221, 224, 0.14)" : "#f0d9dc",
      text: isDark
        ? { primary: "#fff7f7", secondary: "#e2c8cb" }
        : { primary: "#2c1518", secondary: "#785a5e" },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: ['"Inter"', '"Segoe UI"', "Roboto", "sans-serif"].join(","),
      h4: { fontWeight: 800, letterSpacing: "-0.03em" },
      h5: { fontWeight: 800, letterSpacing: "-0.02em" },
      h6: { fontWeight: 700, letterSpacing: "-0.01em" },
      button: { fontWeight: 700, letterSpacing: "0.01em" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundImage: isDark
              ? "radial-gradient(circle at 100% 0%, rgba(200, 30, 42, 0.18), transparent 30%)"
              : "radial-gradient(circle at 100% 0%, #ffe9ea 0, transparent 32%)",
          },
          "::selection": { backgroundColor: "#f5b7bd", color: "#65121a" },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none", borderColor: isDark ? "rgba(255, 221, 224, 0.14)" : "#f0d9dc" },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: "none", fontWeight: 700, borderRadius: 10, boxShadow: "none", paddingInline: 18 },
          contained: { "&:hover": { boxShadow: "0 6px 16px rgba(153, 27, 37, 0.24)" } },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 10, "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#c81e2a" } },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 800, color: isDark ? "#ffeef0" : "#65121a", backgroundColor: isDark ? "rgba(255,255,255,0.035)" : "#fff4f5" },
          root: { borderColor: isDark ? "rgba(255, 221, 224, 0.12)" : "#f5e2e4" },
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 700 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 18 } } },
      MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 8 } } },
    },
  });
}
