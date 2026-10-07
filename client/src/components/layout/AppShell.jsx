import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Tooltip,
  useMediaQuery,
  TextField,
  Button,
} from "@mui/material";

import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import LogoutIcon from "@mui/icons-material/Logout";

import { alpha, useTheme } from "@mui/material/styles";
import { useAuth } from "../../context/AuthContext";
import NotificationBell from "./NotificationBell";
import ProfileDialog from "./ProfileDialog";
import ChatWidget from "../chatbot/ChatWidget";
import ConfirmDialog from "../common/ConfirmDialog";
import AppFooter from "./AppFooter";
import logo from "../../assets/logo.png";

import "./AppShell.css";

const DRAWER_WIDTH = 250;
const COLLAPSED_WIDTH = 72;
const HEADER_HEIGHT = 110;

export default function AppShell({ navItems, ticketSearchPath, raiseTicketPath }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [mobileOpen, setMobileOpen] = useState(false);

  // Sidebar is collapsed when the application loads
  const [collapsed, setCollapsed] = useState(true);

  const [userMenuAnchor, setUserMenuAnchor] = useState(null);
  const [ticketSearch, setTicketSearch] = useState("");
  const [profileDialog, setProfileDialog] = useState(null); // "view" | "edit" | null
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const { user, logout } = useAuth();

  const navigate = useNavigate();

  // Mobile sidebar always shows labels.
  // Desktop sidebar depends on collapsed state.
  const showLabels = isMobile || !collapsed;

  const drawerWidth = isMobile
    ? DRAWER_WIDTH
    : collapsed
      ? COLLAPSED_WIDTH
      : DRAWER_WIDTH;

  const handleLogout = async () => {
    setUserMenuAnchor(null);
    await logout();
    navigate("/login");
  };

  const handleTicketSearch = (event) => {
    event.preventDefault();
    const search = ticketSearch.trim();
    navigate(search ? `${ticketSearchPath}?search=${encodeURIComponent(search)}` : ticketSearchPath);
  };

  // Shared look of a sidebar row: rounded, themed on hover, accent bar on the active one.
  const navItemSx = (labels) => ({
    position: "relative",
    justifyContent: labels ? "flex-start" : "center",
    px: labels ? 2 : 1,
    mx: 1,
    my: 0.25,
    borderRadius: "10px",
    color: "text.primary",
    "& .MuiListItemIcon-root": { color: "text.secondary" },
    "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08), "& .MuiListItemIcon-root": { color: "primary.main" } },
  });

  const drawerContent = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {isMobile && <Toolbar sx={{ minHeight: `${HEADER_HEIGHT}px !important` }} />}

      {/* Expand / Collapse Button */}
      {!isMobile && (
        <Box
          sx={{
            display: "flex",
            justifyContent: showLabels ? "flex-end" : "center",
            px: 1,
            pb: 1,
          }}
        >
          <Tooltip
            title={
              collapsed
                ? "Expand sidebar"
                : "Collapse sidebar"
            }
            placement="right"
            arrow
          >
            <IconButton
              onClick={() => setCollapsed((prev) => !prev)}
              className="sidebar-toggle-button"
              aria-label={
                collapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
              }
            >
              <ChevronLeftIcon
                className={`sidebar-toggle-icon ${
                  collapsed ? "collapsed" : ""
                }`}
              />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Divider />

      {/* Navigation */}
      <List sx={{ flex: 1, py: 1 }}>
        {navItems.map((item) => (
          <Tooltip
            key={item.to}
            title={showLabels ? "" : item.label}
            placement="right"
            arrow
            disableHoverListener={showLabels}
          >
            <ListItemButton
              component={NavLink}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className="sidebar-nav-item"
              sx={{
                ...navItemSx(showLabels),
                "&.active": {
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: "primary.main",
                  "& .MuiListItemIcon-root": { color: "primary.main" },
                  "& .MuiListItemText-primary": { fontWeight: 700 },
                  "&::before": { content: '""', position: "absolute", left: 0, top: 8, bottom: 8, width: 4, borderRadius: "0 4px 4px 0", bgcolor: "primary.main" },
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: showLabels ? 40 : 0,
                  justifyContent: "center",
                  transition: "min-width 0.25s ease-in-out",
                }}
              >
                {item.icon}
              </ListItemIcon>

              <ListItemText
                primary={item.label}
                className={`sidebar-label ${
                  showLabels ? "" : "collapsed"
                }`}
              />
            </ListItemButton>
          </Tooltip>
        ))}
      </List>

      {/* Logout is an action, not a route, so it's a button rather than a NavLink. Same handler
          as the user menu's "Logout" entry; pinned to the bottom-left of the sidebar. */}
      <Divider />
      <Box sx={{ p: 1 }}>
        <Tooltip title={showLabels ? "" : "Logout"} placement="right" arrow disableHoverListener={showLabels}>
          <ListItemButton
            onClick={() => {
              setMobileOpen(false);
              setLogoutConfirmOpen(true);
            }}
            className="sidebar-nav-item"
            sx={{
              ...navItemSx(showLabels),
              mx: 0,
              color: "primary.main",
              "& .MuiListItemIcon-root": { color: "primary.main" },
              "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.12) },
            }}
          >
            <ListItemIcon sx={{ minWidth: showLabels ? 40 : 0, justifyContent: "center", transition: "min-width 0.25s ease-in-out" }}>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText primary="Logout" className={`sidebar-label ${showLabels ? "" : "collapsed"}`} />
          </ListItemButton>
        </Tooltip>
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
      }}
    >
      {/* ================= HEADER ================= */}
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: (t) => t.palette.mode === "dark" ? "rgba(42, 27, 31, 0.92)" : "rgba(255, 255, 255, 0.88)",
          backdropFilter: "blur(12px)",
          zIndex: (t) => t.zIndex.drawer + 1,
          width: "100%",
          height: HEADER_HEIGHT,
        }}
      >
        <Toolbar sx={{ gap: 1, minHeight: `${HEADER_HEIGHT}px !important`, height: HEADER_HEIGHT }}>
          {/* Mobile menu button */}
          {isMobile && (
            <IconButton
              edge="start"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Brand */}
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1.5, mr: 1, cursor: "pointer" }}
            onClick={() => navigate(navItems[0]?.to || "/")}
          >
            <Box
              component="img"
              src={logo}
              alt="SOLVORA"
              sx={{ width: 112, height: 100
                , borderRadius: "50%", flexShrink: 0, display: "block" }}
            />
            <Typography variant="h4" fontWeight={700} noWrap>
              SOLVORA
            </Typography>
          </Box>

          {ticketSearchPath && (
            <Box
              component="form"
              onSubmit={handleTicketSearch}
              sx={{ flexGrow: 1, display: "flex", justifyContent: "center" }}
            >
              <TextField
                size="small"
                placeholder="Search tickets"
                value={ticketSearch}
                onChange={(event) => setTicketSearch(event.target.value)}
                inputProps={{ "aria-label": "Search tickets" }}
                InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} /> }}
                sx={{ width: { xs: 140, sm: "min(360px, 38vw)" } }}
              />
            </Box>
          )}

          {/* Right-side actions — always pushed to the far right via ml:
              "auto" on this wrapper, independent of whether the center
              search box above is rendered (it's conditional on
              ticketSearchPath; this group must not depend on that). */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
            {raiseTicketPath && (
              <Button
                component={NavLink}
                to={raiseTicketPath}
                variant="contained"
                startIcon={<AddIcon />}
                sx={{ whiteSpace: "nowrap" }}
              >
                Create Ticket
              </Button>
            )}

            {/* Notifications */}
            <NotificationBell />

            {/* User */}
            <IconButton
              onClick={(e) =>
                setUserMenuAnchor(e.currentTarget)
              }
            >
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: "primary.main",
                }}
              >
                {user?.name?.[0]?.toUpperCase() || "U"}
              </Avatar>
            </IconButton>
          </Box>

          {/* User Menu */}
          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={() => setUserMenuAnchor(null)}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography
                variant="body2"
                fontWeight={600}
              >
                {user?.name}
              </Typography>

              <Typography
                variant="caption"
                color="text.secondary"
              >
                {user?.email}
              </Typography>
            </Box>

            <Divider />

            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                setProfileDialog("view");
              }}
            >
              Profile
            </MenuItem>

            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                setProfileDialog("edit");
              }}
            >
              Edit Profile
            </MenuItem>

            <Divider />

            <MenuItem onClick={handleLogout}>
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <ProfileDialog
        open={Boolean(profileDialog)}
        mode={profileDialog || "view"}
        onClose={() => setProfileDialog(null)}
      />

      {/* Role-aware assistant — one widget for all four portals (this shell
          is shared by AdminLayout, AgentLayout and PortalLayout). The profile
          and password screens are dialogs, not routes, so the assistant opens
          them through this callback. */}
      <ChatWidget role={user?.role} firstName={String(user?.name || "").split(" ")[0]} onOpenDialog={(dialog) => setProfileDialog(dialog === "edit-profile" ? "edit" : "view")} />

      <ConfirmDialog
        open={logoutConfirmOpen}
        title="Log out?"
        message="Are you sure you want to log out?"
        confirmLabel="Logout"
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          handleLogout();
        }}
      />

      {/* ================= SIDEBAR ================= */}
      <Box
        component="nav"
        className="sidebar-nav"
        sx={{
          width: {
            md: drawerWidth,
          },
          flexShrink: {
            md: 0,
          },
        }}
      >
        <Drawer
          variant={isMobile ? "temporary" : "permanent"}
          open={isMobile ? mobileOpen : true}
          onClose={() => setMobileOpen(false)}
          ModalProps={{
            keepMounted: true,
          }}
          PaperProps={{
            className: "sidebar-paper",
          }}
          sx={{
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
              background: (t) =>
                t.palette.mode === "dark"
                  ? "linear-gradient(180deg, #2a1b1f 0%, #1f1417 100%)"
                  : `linear-gradient(180deg, #ffffff 0%, ${alpha(t.palette.primary.main, 0.07)} 100%)`,
              transition:
                "width 0.25s ease-in-out",
              top: { md: `${HEADER_HEIGHT}px` },
              height: { md: `calc(100% - ${HEADER_HEIGHT}px)` },
            },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      {/* ================= PAGE CONTENT ================= */}
      <Box
        component="main"
        className="main-content"
        sx={{
          flexGrow: 1,
          width: {
            md: `calc(100% - ${drawerWidth}px)`,
          },
          transition:
            "width 0.25s ease-in-out",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Toolbar sx={{ minHeight: `${HEADER_HEIGHT}px !important` }} />

        <Box
          sx={{
            flex: 1,
            p: {
              xs: 2,
              md: 3,
            },
          }}
        >
          <Outlet />
        </Box>

        <AppFooter />
      </Box>
    </Box>
  );
}
