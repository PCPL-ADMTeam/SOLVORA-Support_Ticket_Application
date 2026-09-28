import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link as RouterLink } from "react-router-dom";
import { Box, Paper, Button, Typography, Alert, Stack, Link } from "@mui/material";
import { keyframes } from "@emotion/react";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useAuth } from "../../context/AuthContext";
import { homeForRole } from "../../routes/ProtectedRoute";
import AppFooter from "../../components/layout/AppFooter";
import FormField from "../../components/common/FormField";
import logo from "../../assets/logo.png";
 
// Same node-and-line mesh as before, reused (mirrored) in all four corners —
// now driven by canvas + requestAnimationFrame instead of static SVG so it
// can float, pulse, react to the cursor, and occasionally flash a path.
const NODES = [
  { x: 150, y: 150, r: 11 },
  { x: 90, y: 110, r: 6 },
  { x: 200, y: 90, r: 8 },
  { x: 230, y: 150, r: 5 },
  { x: 260, y: 200, r: 7 },
  { x: 60, y: 180, r: 5 },
  { x: 110, y: 225, r: 4 },
  { x: 180, y: 230, r: 6 },
  { x: 40, y: 90, r: 4 },
  { x: 20, y: 140, r: 3 },
  { x: 270, y: 80, r: 4 },
  { x: 150, y: 40, r: 3 },
  { x: 230, y: 265, r: 8 },
  { x: 90, y: 275, r: 4 },
  { x: 10, y: 220, r: 3 },
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
  [1, 8], [1, 5], [1, 9],
  [2, 10], [2, 11], [2, 3],
  [3, 4], [3, 10],
  [4, 12],
  [5, 6], [5, 9], [5, 14],
  [6, 7], [6, 13],
  [7, 12],
  [12, 13],
  [8, 9],
  [13, 14],
];
const CORNERS = ["tl", "tr", "bl", "br"];
 
const ADJACENCY = NODES.map(() => []);
EDGES.forEach(([a, b], edgeIndex) => {
  ADJACENCY[a].push({ to: b, edgeIndex });
  ADJACENCY[b].push({ to: a, edgeIndex });
});
 
// Maps a node's local 300x300 coordinate onto whichever corner of the page
// it belongs to (mirroring for the right/bottom corners), given the current
// canvas size — same math the old CSS `transform: scaleX(-1)` etc. did.
function cornerPosition(corner, x, y, width, height) {
  const left = x - 20;
  const top = y - 20;
  switch (corner) {
    case "tr": return [width - left, top];
    case "bl": return [left, height - top];
    case "br": return [width - left, height - top];
    default: return [left, top];
  }
}
 
// Purely decorative (aria-hidden) animated background: floating/pulsing
// nodes, lines that fade in and out, nodes gently pulled toward a nearby
// cursor (with a brighter hover glow) and a soft gradient that follows the
// pointer, plus an occasional highlighted path. Everything lives in
// refs/canvas so the animation never triggers a React re-render.
function NetworkBackground() {
  const canvasRef = useRef(null);
 
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    const ctx = canvas.getContext("2d");
 
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
 
    function resize() {
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);
 
    const mouse = { x: -9999, y: -9999 };
    function handleMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    }
    function handleMouseLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseleave", handleMouseLeave);
 
    const particles = [];
    CORNERS.forEach((corner) => {
      NODES.forEach((n, index) => {
        particles.push({
          corner,
          index,
          baseX: n.x,
          baseY: n.y,
          r: n.r,
          phaseX: Math.random() * Math.PI * 2,
          phaseY: Math.random() * Math.PI * 2,
          phasePulse: Math.random() * Math.PI * 2,
          freqX: 0.15 + Math.random() * 0.1,
          freqY: 0.12 + Math.random() * 0.1,
          freqPulse: 0.2 + Math.random() * 0.15,
        });
      });
    });
 
    let highlight = null; // { corner, edgeIndices, start, duration }
    let nextHighlightAt = 2000 + Math.random() * 2000;
 
    function pickHighlightPath() {
      const corner = CORNERS[Math.floor(Math.random() * CORNERS.length)];
      let current = Math.floor(Math.random() * NODES.length);
      const visited = new Set([current]);
      const edgeIndices = [];
      const steps = 2 + Math.floor(Math.random() * 3);
      for (let s = 0; s < steps; s++) {
        const options = ADJACENCY[current].filter((o) => !visited.has(o.to));
        if (!options.length) break;
        const pick = options[Math.floor(Math.random() * options.length)];
        edgeIndices.push(pick.edgeIndex);
        visited.add(pick.to);
        current = pick.to;
      }
      return { corner, edgeIndices };
    }
 
    let rafId;
    function drawFrame(elapsed) {
      const t = elapsed / 1000;
      ctx.clearRect(0, 0, width, height);
 
      // Soft gradient that follows the cursor, drawn first (underneath).
      if (mouse.x > -1000) {
        const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 220);
        gradient.addColorStop(0, "rgba(200, 30, 42, 0.10)");
        gradient.addColorStop(1, "rgba(200, 30, 42, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
 
      // Live position for every node this frame: float + pulse + a gentle
      // push away from a nearby cursor.
      const positions = new Map();
      particles.forEach((p) => {
        const [bx, by] = cornerPosition(p.corner, p.baseX, p.baseY, width, height);
        let x = bx + Math.sin(t * p.freqX + p.phaseX) * 6;
        let y = by + Math.cos(t * p.freqY + p.phaseY) * 6;
 
        const dx = mouse.x - x;
        const dy = mouse.y - y;
        const dist = Math.hypot(dx, dy);
        const influence = 170;
        let glow = 0;
        if (dist < influence) {
          glow = 1 - dist / influence;
          // Pulled toward the cursor (not pushed away) — capped so nodes
          // never actually reach the pointer, just lean in toward it.
          if (dist > 0.001) {
            x += (dx / dist) * glow * 22;
            y += (dy / dist) * glow * 22;
          }
        }
 
        const pulse = 0.75 + 0.25 * Math.sin(t * p.freqPulse + p.phasePulse);
        positions.set(`${p.corner}-${p.index}`, { x, y, r: p.r * pulse, glow });
      });
 
      // Occasionally flash a short random path brighter for ~1.4s.
      if (!highlight && elapsed >= nextHighlightAt) {
        highlight = { ...pickHighlightPath(), start: elapsed, duration: 1400 };
        nextHighlightAt = elapsed + 4000 + Math.random() * 3000;
      }
      let highlightProgress = 0;
      if (highlight) {
        const age = elapsed - highlight.start;
        if (age > highlight.duration) {
          highlight = null;
        } else {
          const half = highlight.duration / 2;
          highlightProgress = age < half ? age / half : 1 - (age - half) / half;
        }
      }
 
      CORNERS.forEach((corner) => {
        EDGES.forEach(([a, b], edgeIndex) => {
          const pa = positions.get(`${corner}-${a}`);
          const pb = positions.get(`${corner}-${b}`);
          if (!pa || !pb) return;
 
          // Lines gradually fade in/out on their own slow cycle.
          const flicker = 0.5 + 0.5 * Math.sin(t * 0.3 + edgeIndex * 1.3 + corner.charCodeAt(0));
          let opacity = 0.06 + flicker * 0.14;
          let lineWidth = 1;
 
          if (highlight && highlight.corner === corner && highlight.edgeIndices.includes(edgeIndex)) {
            opacity = 0.06 + highlightProgress * 0.55;
            lineWidth = 1 + highlightProgress * 1.5;
          }
 
          opacity = Math.min(1, opacity + Math.max(pa.glow, pb.glow) * 0.25);
 
          ctx.strokeStyle = `rgba(200, 30, 42, ${opacity})`;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        });
      });
 
      positions.forEach((p) => {
        const baseOpacity = 0.22 + (p.r / 11) * 0.18;
        ctx.beginPath();
        ctx.fillStyle = `rgba(200, 30, 42, ${Math.min(1, baseOpacity + p.glow * 0.55)})`;
        ctx.arc(p.x, p.y, p.r + p.glow * 4, 0, Math.PI * 2);
        ctx.fill();
      });
 
      if (!reduceMotion) rafId = requestAnimationFrame(drawFrame);
    }
 
    // Reduced-motion: paint a single static frame and stop there.
    rafId = requestAnimationFrame(drawFrame);
 
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);
 
  return (
    <Box
      component="canvas"
      ref={canvasRef}
      aria-hidden
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
 
// One full rotation per second for 10s (10 full spins), ending back at a
// multiple of 360deg — visually identical to the resting position, so no
// explicit "reset" step is needed once the animation completes.
const logoSpin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(3600deg); }
`;
const LOGO_SPIN_CLICKS = 5;
const LOGO_SPIN_DURATION_MS = 10000;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Easter egg: click the logo 5 times to make it spin for 10 seconds.
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
  const logoClickCount = useRef(0);

  const handleLogoClick = () => {
    if (isLogoSpinning) return;
    logoClickCount.current += 1;
    if (logoClickCount.current >= LOGO_SPIN_CLICKS) {
      logoClickCount.current = 0;
      setIsLogoSpinning(true);
      setTimeout(() => setIsLogoSpinning(false), LOGO_SPIN_DURATION_MS);
    }
  };

  const handleLogoKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleLogoClick();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(email, password);
      const redirectTo = location.state?.from?.pathname || homeForRole(user.role.name);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
 
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        bgcolor: "background.default",
        backgroundImage: "radial-gradient(circle at 15% 20%, #ffe1e3 0, transparent 28%), radial-gradient(circle at 85% 80%, #f8dadd 0, transparent 24%)",
      }}
    >
      <NetworkBackground />
 
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: { xs: 2, md: 4 }, position: "relative" }}>
        <Paper
          elevation={0}
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            width: 760,
            maxWidth: "100%",
            minHeight: { md: 500 },
            borderRadius: "32px",
            overflow: "hidden",
            border: "1.5px solid rgba(180, 55, 50, 0.45)",
            boxShadow: "0 20px 60px rgba(120, 40, 35, 0.10)",
          }}
        >
          {/* ================= LEFT — brand section (45%) ================= */}
          <Box
            sx={{
              flexBasis: { md: "45%" },
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              textAlign: "center",
              color: "#fff7f7",
              p: { xs: 4, md: 5 },
              background: "linear-gradient(160deg, #c81e2a 0%, #991b25 100%)",
            }}
          >
            {/* Decorative blurred circles — purely visual */}
            <Box aria-hidden sx={{ position: "absolute", width: 150, height: 150, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.08)", top: -60, right: -60 }} />
            <Box aria-hidden sx={{ position: "absolute", width: 140, height: 140, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.06)", top: 60, right: -30 }} />
 
            <Stack spacing={1.5} alignItems="center" sx={{ position: "relative" }}>
              <Box
                role="button"
                tabIndex={0}
                onClick={handleLogoClick}
                onKeyDown={handleLogoKeyDown}
                sx={{
                  position: "relative",
                  width: 150,
                  height: 150,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  outline: "none",
                  borderRadius: "50%",
                  "&:focus-visible": { boxShadow: "0 0 0 3px rgba(255,255,255,0.6)" },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.12) 45%, transparent 72%)",
                  }}
                />
                <Box
                  component="img"
                  src={logo}
                  alt="SOLVORA"
                  sx={{
                    position: "relative",
                    width: 112,
                    height: 112,
                    borderRadius: "50%",
                    objectFit: "cover",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                    animation: isLogoSpinning ? `${logoSpin} ${LOGO_SPIN_DURATION_MS}ms linear` : "none",
                  }}
                />
              </Box>
              <Typography variant="h4" fontWeight={800}>SOLVORA</Typography>
              <Typography variant="body1" sx={{ opacity: 0.9 }}>IT Ticketing & Support System</Typography>
 
              <Box sx={{ width: 48, height: 2, bgcolor: "rgba(255,255,255,0.5)", my: 1 }} />
 
              <Typography variant="body2" sx={{ opacity: 0.85, maxWidth: 260 }}>
                Report issues, track progress, and get faster support.
              </Typography>
            </Stack>
 
            {/* Decorative circle cluster — purely visual, echoes the two
                blurred circles already used above so the panel reads as one
                consistent motif rather than a mismatched icon illustration. */}
            <Box aria-hidden sx={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 1.5, height: 64, mt: 4 }}>
              <Box sx={{ width: 56, height: 56, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.10)" }} />
              <Box sx={{ width: 34, height: 34, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.16)", mb: 2.5 }} />
              <Box sx={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.35)" }} />
            </Box>
          </Box>
 
          {/* ================= Center divider — vertical on desktop, horizontal on mobile ================= */}
          <Box
            aria-hidden
            sx={{
              borderLeft: { xs: "none", md: "1px solid rgba(180, 55, 50, 0.15)" },
              borderTop: { xs: "1px solid rgba(180, 55, 50, 0.15)", md: "none" },
            }}
          />
 
          {/* ================= RIGHT — form (55%) ================= */}
          <Box
            sx={{
              flexBasis: { md: "55%" },
              p: { xs: 4, sm: 5, md: 6 },
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <Stack spacing={0.5} sx={{ mb: 3 }}>
              <Typography variant="h5" fontWeight={800}>
                Hi there! <span role="img" aria-label="waving hand"></span>
              </Typography>
              <Typography variant="body2" color="text.secondary">Sign in to access your Solvora account</Typography>
            </Stack>
 
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
 
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2.5}>
                <FormField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
 
                <FormField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
 
                <Box sx={{ textAlign: "right", mt: -1 }}>
                  <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover" fontWeight={600}>
                    Forgot Password?
                  </Link>
                </Box>
 
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={submitting}
                  fullWidth
                  endIcon={!submitting && <ArrowForwardIcon />}
                >
                  {submitting ? "Signing in..." : "Sign In"}
                </Button>
              </Stack>
            </Box>
          </Box>
        </Paper>
      </Box>
 
      <Box sx={{ position: "relative" }}>
        <AppFooter />
      </Box>
    </Box>
  );
}