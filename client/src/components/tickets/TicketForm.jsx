import { useEffect, useMemo, useState } from "react";
import {
  Stack,
  TextField,
  Button,
  Typography,
  Box,
  Autocomplete,
  Paper,
  Divider,
  Alert,
} from "@mui/material";

import AttachFileIcon from "@mui/icons-material/AttachFile";
import FlagIcon from "@mui/icons-material/Flag";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";

import { useAuth } from "../../context/AuthContext";
import { departmentsApi } from "../../api/departments";
import { prioritiesApi } from "../../api/catalog";
import AttachmentList from "./AttachmentList";
import AttachmentPreview from "./AttachmentPreview";
import RichTextField from "./RichTextField";
import SearchableUserSelector from "../common/SearchableUserSelector";
import {
  MAX_ATTACHMENT_MB,
  MAX_ATTACHMENTS_PER_TICKET,
  MAX_ATTACHMENTS_TOTAL_SIZE_MB,
  MAX_ATTACHMENTS_TOTAL_SIZE_BYTES,
  validateNewAttachments,
} from "../../utils/attachmentValidation";

// Mirrors ticket.service.js's MAX_PROBLEM_SUMMARY_WORDS exactly.
const MAX_PROBLEM_SUMMARY_WORDS = 50;

function countWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const fieldLabelSx = {
  fontSize: 14,
  fontWeight: 600,
  color: "text.primary",
  mb: 1,
};

const sectionTitleSx = {
  fontSize: 16,
  fontWeight: 700,
  color: "text.primary",
  mb: 0.5,
};

const sectionSubtitleSx = {
  fontSize: 13,
  color: "text.secondary",
};

/* =========================================================
   COMPONENT
========================================================= */

export default function TicketForm({
  onSubmit,
  submitting = false,
  // "edit" reuses this exact form to let a ticket's own requester update
  // the ticket's title/priority/Problem Summary (and add more attachments) —
  // see EditTicketPage.jsx. Department is fixed once a ticket exists (its
  // ticket number/manager are already derived from it — see
  // ticket.service.js#createTicket's comment on stable ticket numbers), so
  // it's shown read-only rather than as a picker in this mode.
  mode = "create",
  initialTicket = null,
  onCancel = null,
}) {
  const { user } = useAuth();
  const isEdit = mode === "edit";
  // A Manager may hold several departments (UserDepartmentAccess) — unlike
  // an Employee/Team Lead, who each have exactly one unambiguous "From
  // Department," a Manager must pick which of theirs this request is from
  // (see the "From Department" field below and
  // ticket.service.js#resolveFromDepartmentId, which independently
  // validates whatever is submitted here against their real access).
  const isManagerRole = user.role.name === "MANAGER";

  const [departments, setDepartments] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  useEffect(() => {
    Promise.all([
      departmentsApi.list(),
      prioritiesApi.list(),
    ])
      .then(([deptRes, priorityRes]) => {
        setDepartments(deptRes.data.data);
        setPriorities(priorityRes.data.data);
      })
      .finally(() => {
        setLoadingOptions(false);
      });
  }, []);

  const [form, setForm] = useState(() =>
    isEdit && initialTicket
      ? {
          title: initialTicket.title || "",
          priorityId: initialTicket.priority.id,
          toDepartmentId: initialTicket.toDepartment?.id || "",
          problemSummary: initialTicket.problemSummary || "",
        }
      : {
          title: "",
          priorityId: "",
          toDepartmentId: "",
          problemSummary: "",
          fromDepartmentId: isManagerRole ? (user.departmentAccess?.[0]?.id || "") : "",
        }
  );

  const [attachments, setAttachments] = useState([]);
  const [errors, setErrors] = useState({});

  // The rich-text Problem Summary editor's CURRENT VISIBLE TEXT ONLY (never
  // its HTML) — kept in sync via RichTextField's onChange (Quill's own
  // getText()) so the 50-word count/required-check below never has to parse
  // HTML on this side either. Old plain-text tickets have no HTML tags to
  // begin with, so this starts identical to `form.problemSummary` for both
  // modes.
  const [problemSummaryPlainText, setProblemSummaryPlainText] = useState(() =>
    isEdit && initialTicket ? initialTicket.problemSummary || "" : ""
  );

  /* =========================================================
     CUSTOM CC (create mode only — the ticket's CC list is fixed at
     creation time and there is no post-creation CC-editing UI, see
     ticket.service.js#createTicket / TicketCC). Search/debounce/loading are
     all handled by the shared SearchableUserSelector below.
  ========================================================= */

  const [ccOpen, setCcOpen] = useState(false);
  const [ccSelected, setCcSelected] = useState([]);

  /* =========================================================
     SELECTED VALUES
  ========================================================= */

  const selectedDepartment = useMemo(
    () =>
      departments.find(
        (d) => d.id === form.toDepartmentId
      ) || null,
    [departments, form.toDepartmentId]
  );

  // Manager-only — which of their own UserDepartmentAccess departments this
  // request is "from" (see the "From Department" field below).
  const selectedFromDepartment = useMemo(
    () => (user.departmentAccess || []).find((d) => d.id === form.fromDepartmentId) || null,
    [user.departmentAccess, form.fromDepartmentId]
  );

  const selectedPriority = useMemo(
    () =>
      priorities.find(
        (p) => p.id === form.priorityId
      ) || null,
    [priorities, form.priorityId]
  );

  /* =========================================================
     NORMAL FIELD CHANGE
  ========================================================= */

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  };

  /* =========================================================
     DEPARTMENT CHANGE
  ========================================================= */

  const handleDepartmentChange = (_, value) => {
    setForm((prev) => ({
      ...prev,
      toDepartmentId: value?.id || "",
    }));

    setErrors((prev) => ({
      ...prev,
      toDepartmentId: "",
    }));
  };

  /* =========================================================
     ATTACHMENT
  ========================================================= */

  // A ticket may have at most MAX_ATTACHMENTS_PER_TICKET total — counting
  // both what's already saved on the ticket (edit mode only; a new ticket
  // always starts at 0) and whatever's already staged for upload in this
  // form session. Combined SIZE is tracked the same way, against
  // MAX_ATTACHMENTS_TOTAL_SIZE_BYTES — never per file.
  const existingAttachmentCount = isEdit ? initialTicket?.attachments?.length || 0 : 0;
  const existingAttachmentSize = isEdit
    ? (initialTicket?.attachments || []).reduce((sum, a) => sum + (a.fileSize || 0), 0)
    : 0;
  const stagedAttachmentSize = attachments.reduce((sum, f) => sum + (f.size || 0), 0);
  const totalAttachmentSize = existingAttachmentSize + stagedAttachmentSize;
  const remainingAttachmentSlots = Math.max(MAX_ATTACHMENTS_PER_TICKET - existingAttachmentCount - attachments.length, 0);
  const remainingAttachmentBytes = Math.max(MAX_ATTACHMENTS_TOTAL_SIZE_BYTES - totalAttachmentSize, 0);

  // Single reusable entry point for adding files, regardless of source —
  // the "Upload File" input and a Ctrl+V clipboard image paste (see
  // RichTextField's onImagePaste below) both funnel through this exact same
  // validation, so a pasted screenshot counts toward, and can be rejected
  // by, the exact same count/size caps as an uploaded file (see
  // utils/attachmentValidation.js — shared with nothing duplicated here).
  const addAttachmentFiles = (files) => {
    if (!files.length) return;
    const { validFiles, error } = validateNewAttachments(files, {
      remainingSlots: remainingAttachmentSlots,
      remainingBytes: remainingAttachmentBytes,
    });
    if (validFiles.length) setAttachments((prev) => [...prev, ...validFiles]);
    setErrors((prev) => ({ ...prev, attachments: error }));
  };

  const handleAttachmentChange = (event) => {
    addAttachmentFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };

  // Feature 1 — a clipboard image pasted while the Problem Summary editor is
  // focused never becomes inline content (see RichTextField's paste
  // interception); it arrives here as a plain File and is added exactly as
  // if it had been picked via "Upload File." `files` is always a plain array
  // (RichTextField already filters/converts clipboard items itself), so a
  // conversion failure there simply results in an empty array — nothing to
  // add, nothing to error on, since there was nothing usable on the
  // clipboard to begin with.
  const handleImagePaste = (files) => {
    if (!files.length) {
      setErrors((prev) => ({ ...prev, attachments: "Could not read the pasted image. Try again or use Upload File instead." }));
      return;
    }
    addAttachmentFiles(files);
  };

  const removeAttachment = (index) => {
    setAttachments((prev) =>
      prev.filter(
        (_, fileIndex) => fileIndex !== index
      )
    );
  };

  /* =========================================================
     VALIDATION
  ========================================================= */

  // Word count/required-check run against the PLAIN TEXT RichTextField hands
  // back (Quill's own getText()), never the stored HTML — so
  // "<b>Unable</b> to access <i>Power BI</i>" counts as the 5 visible words
  // it reads as ("Unable to access Power BI"), not those words plus markup.
  const problemSummaryWordCount = countWords(problemSummaryPlainText);

  const validateForm = () => {
    const newErrors = {};

    if (!form.title.trim()) {
      newErrors.title = "Title is required";
    }

    if (!form.priorityId) {
      newErrors.priorityId = "Priority is required";
    }

    if (!form.toDepartmentId) {
      newErrors.toDepartmentId =
        "Department is required";
    }

    if (!problemSummaryPlainText.trim()) {
      newErrors.problemSummary = "Problem Summary is required";
    } else if (problemSummaryWordCount > MAX_PROBLEM_SUMMARY_WORDS) {
      newErrors.problemSummary = `Problem Summary must be ${MAX_PROBLEM_SUMMARY_WORDS} words or fewer (currently ${problemSummaryWordCount}).`;
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  /* =========================================================
     SUBMIT
  ========================================================= */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validateForm()) return;

    const ticketTitle = form.title.trim();
    const problemSummary = form.problemSummary.trim();

    if (isEdit) {
      // PATCH /tickets/:id only ever takes JSON (no multer on that route —
      // see ticket.routes.js), so edits go through as a plain object; any
      // newly-added attachment files are uploaded separately afterward via
      // the existing POST /tickets/:id/attachments endpoint, same as
      // comment attachments already do (see TicketDetailPage's
      // handleAddComment). Existing attachments are left untouched.
      const payload = {
        title: ticketTitle,
        problemSummary,
        priorityId: form.priorityId,
      };
      await onSubmit(payload, attachments);
      return;
    }

    const formData = new FormData();

    formData.append("title", ticketTitle);
    formData.append(
      "problemSummary",
      problemSummary
    );
    formData.append(
      "priorityId",
      form.priorityId
    );
    formData.append(
      "toDepartmentId",
      form.toDepartmentId
    );

    // Manager-only — see ticket.service.js#resolveFromDepartmentId, which
    // independently validates this against the caller's real
    // UserDepartmentAccess; never sent for Employee/Team Lead, both of whom
    // have their From Department derived server-side instead.
    if (isManagerRole && form.fromDepartmentId) {
      formData.append("fromDepartmentId", form.fromDepartmentId);
    }

    ccSelected.forEach((u) => {
      formData.append("ccUserIds", u.id);
    });

    attachments.forEach((file) => {
      formData.append("attachments", file);
    });

    await onSubmit(formData);
  };

  /* =========================================================
     UI
  ========================================================= */

  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        maxWidth: 900,
        mx: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: 3,
        overflow: "hidden",
        backgroundColor: "#ffffff",
      }}
    >
      {/* ===================================================
          HEADER
      =================================================== */}

      <Box
        sx={{
          px: { xs: 3, md: 4 },
          py: 3,
          backgroundColor: "action.hover",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography
          sx={{
            fontSize: 22,
            fontWeight: 700,
            color: "text.primary",
          }}
        >
          {isEdit ? "Edit Ticket" : "Raise a Ticket"}
        </Typography>

        <Typography
          sx={{
            mt: 0.5,
            fontSize: 14,
            color: "text.secondary",
          }}
        >
          {isEdit
            ? "Update the title, priority, or problem summary of this ticket."
            : "Provide the details below to create a support ticket."}
        </Typography>
      </Box>

      {/* ===================================================
          FORM
      =================================================== */}

      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          p: { xs: 3, md: 4 },
        }}
      >
        <Stack spacing={3}>
          {/* A home department is required to raise a ticket at all — for an
              EMPLOYEE that's User.departmentId, for a MANAGER it's having
              at least one UserDepartmentAccess department to pick from. A
              TEAMLEAD always has exactly one (enforced elsewhere) so is
              never blocked here. */}
          {(!user.department && user.role.name === "EMPLOYEE") || (isManagerRole && !user.departmentAccess?.length) ? (
            <Alert severity="warning">
              Your account has no department assigned,
              so you can't raise a ticket yet. Contact
              an administrator to have one assigned to
              you.
            </Alert>
          ) : (
            <>
              {/* =================================================
                  TICKET DETAILS
              ================================================= */}

              <Box>
                <Typography sx={sectionTitleSx}>
                  Ticket Details
                </Typography>

                <Typography
                  sx={sectionSubtitleSx}
                >
                  Provide a title, select the department and
                  priority, and describe the problem.
                </Typography>
              </Box>

              <Divider />

              {/* =================================================
                  TITLE
              ================================================= */}

              <Box>
                <Typography sx={fieldLabelSx}>
                  Title
                </Typography>

                <TextField
                  fullWidth
                  size="small"
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  placeholder="Enter a short issue title"
                  error={Boolean(errors.title)}
                  helperText={errors.title}
                  inputProps={{ maxLength: 200 }}
                />
              </Box>

              {/* =================================================
                  PRIORITY
              ================================================= */}

              <Box>
                <Typography sx={fieldLabelSx}>
                  Priority
                </Typography>

                <Autocomplete
                  fullWidth
                  size="small"
                  loading={loadingOptions}
                  options={priorities}
                  getOptionLabel={(p) => p.name}
                  value={selectedPriority}
                  onChange={(_, value) => {
                    setForm((prev) => ({
                      ...prev,
                      priorityId:
                        value?.id || "",
                    }));

                    setErrors((prev) => ({
                      ...prev,
                      priorityId: "",
                    }));
                  }}
                  renderOption={(props, option) => (
                    <li
                      {...props}
                      key={option.id}
                    >
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: option.color,
                          mr: 1.25,
                          flexShrink: 0,
                        }}
                      />

                      {option.name}
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Select priority"
                      error={Boolean(
                        errors.priorityId
                      )}
                      helperText={
                        errors.priorityId
                      }
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <>
                            <FlagIcon
                              fontSize="small"
                              sx={{
                                color:
                                  selectedPriority?.color ||
                                  "text.disabled",
                                mr: 0.5,
                              }}
                            />

                            {
                              params.InputProps
                                .startAdornment
                            }
                          </>
                        ),
                      }}
                    />
                  )}
                />
              </Box>

              {/* =================================================
                  FROM / TO DEPARTMENT
              ================================================= */}

              <Stack
                direction={{
                  xs: "column",
                  md: "row",
                }}
                spacing={2}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography
                    sx={fieldLabelSx}
                  >
                    From Department
                  </Typography>

                  {isManagerRole ? (
                    // A Manager has no single home department — they pick
                    // which of their own accessible departments this
                    // request is from; the backend independently validates
                    // the selection against their real UserDepartmentAccess
                    // (see ticket.service.js#resolveFromDepartmentId) and
                    // never trusts this value alone.
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={user.departmentAccess || []}
                      getOptionLabel={(d) => d.name}
                      value={selectedFromDepartment}
                      onChange={(_, value) => setForm((prev) => ({ ...prev, fromDepartmentId: value?.id || "" }))}
                      renderInput={(params) => (
                        <TextField {...params} placeholder="Select department" helperText="Your department" />
                      )}
                    />
                  ) : (
                    // Employee/Team Lead each have exactly one unambiguous
                    // department — Employee via User.departmentId, Team
                    // Lead via their one UserDepartmentAccess row (both
                    // already resolved into `user.department` by
                    // authService#buildAuthenticatedUser) — so this stays a
                    // plain read-only field, never a picker, for either.
                    <TextField
                      fullWidth
                      value={user.department?.name || "—"}
                      helperText="Your department"
                      size="small"
                      InputProps={{
                        readOnly: true,
                      }}
                    />
                  )}
                </Box>

                <Box sx={{ flex: 1 }}>
                  <Typography
                    sx={fieldLabelSx}
                  >
                    Department
                  </Typography>

                  {isEdit ? (
                    // A ticket's department is fixed once raised — its
                    // ticket number/manager are already derived from it
                    // (see ticket.service.js#createTicket) — so this is
                    // shown for context only, not editable here.
                    <TextField
                      fullWidth
                      size="small"
                      value={selectedDepartment?.name || ""}
                      helperText="Fixed at creation — cannot be changed"
                      InputProps={{ readOnly: true }}
                    />
                  ) : (
                    <Autocomplete
                      fullWidth
                      size="small"
                      loading={loadingOptions}
                      options={departments}
                      getOptionLabel={(d) => d.name}
                      value={selectedDepartment}
                      onChange={
                        handleDepartmentChange
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          placeholder="Select department"
                          error={Boolean(
                            errors.toDepartmentId
                          )}
                          helperText={
                            errors.toDepartmentId
                          }
                        />
                      )}
                    />
                  )}
                </Box>
              </Stack>

              {/* =================================================
                  CUSTOM CC (create mode only)
              ================================================= */}

              {!isEdit && (
                <Box>
                  <Typography sx={fieldLabelSx}>
                    Custom CC (optional)
                  </Typography>

                  {!ccOpen ? (
                    <Button
                      variant="outlined"
                      startIcon={<PersonAddAlt1Icon />}
                      onClick={() => setCcOpen(true)}
                      sx={{
                        textTransform: "none",
                        borderRadius: 2,
                        px: 2,
                        py: 1,
                      }}
                    >
                      Custom CC
                    </Button>
                  ) : (
                    <SearchableUserSelector
                      multiple
                      placeholder="Search employee name..."
                      excludeIds={[user.id]}
                      value={ccSelected}
                      onChange={setCcSelected}
                      autoFocus
                    />
                  )}

                  <Typography
                    sx={{
                      mt: 0.75,
                      fontSize: 12,
                      color: "text.secondary",
                    }}
                  >
                    These people will be CC'd on all email notifications for this ticket.
                  </Typography>
                </Box>
              )}

              {/* =================================================
                  PROBLEM SUMMARY
              ================================================= */}

              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                  <Typography sx={fieldLabelSx}>
                    Problem Summary
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 12,
                      color: problemSummaryWordCount > MAX_PROBLEM_SUMMARY_WORDS ? "primary.main" : "text.secondary",
                    }}
                  >
                    {problemSummaryWordCount} / {MAX_PROBLEM_SUMMARY_WORDS} words
                  </Typography>
                </Stack>

                <RichTextField
                  value={form.problemSummary}
                  onChange={(html, plainText) => {
                    setForm((prev) => ({ ...prev, problemSummary: html }));
                    setProblemSummaryPlainText(plainText);
                    setErrors((prev) => ({ ...prev, problemSummary: "" }));
                  }}
                  onImagePaste={handleImagePaste}
                  placeholder="Briefly describe the problem (50 words max)..."
                  error={errors.problemSummary}
                />
              </Box>

              {/* =================================================
                  ATTACHMENT
              ================================================= */}

              {isEdit && initialTicket?.attachments?.length > 0 && (
                <AttachmentList ticketId={initialTicket.id} attachments={initialTicket.attachments} />
              )}

              <Box>
                <Typography sx={fieldLabelSx}>
                  {isEdit ? "Add Attachment" : "Attachment"}
                </Typography>

                {remainingAttachmentSlots > 0 && remainingAttachmentBytes > 0 ? (
                  <Button
                    component="label"
                    variant="outlined"
                    startIcon={
                      <AttachFileIcon />
                    }
                    sx={{
                      textTransform: "none",
                      borderRadius: 2,
                      px: 2,
                      py: 1,
                    }}
                  >
                    Upload File

                    <input
                      type="file"
                      hidden
                      multiple
                      onChange={
                        handleAttachmentChange
                      }
                    />
                  </Button>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {remainingAttachmentSlots > 0
                      ? "Maximum combined attachment size reached — remove one to add another."
                      : "Maximum attachments reached — remove one to add another."}
                  </Typography>
                )}

                <Typography
                  sx={{
                    mt: 0.75,
                    fontSize: 12,
                    color: "text.secondary",
                  }}
                >
                  Any file type — up to {MAX_ATTACHMENT_MB} MB.
                  <br />
                  Attachments: {existingAttachmentCount + attachments.length} / {MAX_ATTACHMENTS_PER_TICKET}
                  {" "}&nbsp;•&nbsp; Size: {(totalAttachmentSize / (1024 * 1024)).toFixed(1)} MB / {MAX_ATTACHMENTS_TOTAL_SIZE_MB} MB
                </Typography>

                {errors.attachments && (
                  <Typography
                    sx={{
                      color: "primary.main",
                      fontSize: 12,
                      mt: 0.5,
                    }}
                  >
                    {errors.attachments}
                  </Typography>
                )}

                <AttachmentPreview files={attachments} onRemove={removeAttachment} />
              </Box>

              {/* =================================================
                  ACTION BUTTON
              ================================================= */}

              <Divider />

              <Box
                sx={{
                  display: "flex",
                  justifyContent:
                    "flex-end",
                  gap: 1.5,
                }}
              >
                {isEdit && onCancel && (
                  <Button
                    onClick={onCancel}
                    disabled={submitting}
                    sx={{ py: 1.2, borderRadius: 2, textTransform: "none", fontWeight: 600 }}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="submit"
                  variant="contained"
                  disabled={
                    submitting ||
                    loadingOptions
                  }
                  sx={{
                    minWidth: 160,
                    py: 1.2,
                    borderRadius: 2,
                    textTransform:
                      "none",
                    fontWeight: 600,
                  }}
                >
                  {submitting
                    ? "Submitting..."
                    : isEdit
                      ? "Update Ticket"
                      : "Raise a Ticket"}
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}
