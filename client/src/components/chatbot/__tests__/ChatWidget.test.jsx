import { describe, expect, test, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../../api/chatbot", () => ({
  chatbotApi: {
    suggestions: vi.fn(),
    sendMessage: vi.fn(),
    resetConversation: vi.fn(),
    sendFeedback: vi.fn(),
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
    uploadDraftFiles: vi.fn(),
    removeDraftFile: vi.fn(),
    reviewDraft: vi.fn(),
    searchDraftCc: vi.fn(),
    fetchDraftFile: vi.fn(),
    listConversations: vi.fn(),
    resumeConversation: vi.fn(),
    getConversation: vi.fn(),
    deleteConversation: vi.fn(),
  },
}));

import { chatbotApi } from "../../../api/chatbot";
import ChatWidget from "../ChatWidget";

const INTRO = {
  portal: "Employee Portal",
  role: "EMPLOYEE",
  welcomeMessage: "Hi Alice! I'm your Employee Portal assistant.",
  suggestions: ["Show my open tickets", "How do I change my password?"],
  welcomeSubtitle: "How can I help you manage your departments and tickets today?",
  quickActions: [
    { label: "My Tickets", prompt: "Show my tickets", icon: "tickets" },
    { label: "Open Tickets", prompt: "Show open tickets", icon: "open" },
    { label: "Department Tickets", prompt: "Show my department tickets", icon: "department" },
    { label: "Notifications", prompt: "Show my notifications", icon: "notifications" },
  ],
  capabilities: [
    { title: "Tickets", items: ["View tickets in your authorized departments", "Assign and reassign tickets (you confirm first)"] },
    { title: "Notifications", items: ["View your notifications"] },
  ],
};

const reply = (over = {}) => ({
  data: {
    data: {
      conversationId: "conv-1",
      messageId: "msg-1",
      message: "Here you go.",
      intent: "navigate",
      data: {},
      suggestedActions: [],
      navigationTarget: null,
      error: null,
      ...over,
    },
  },
});

const apiError = (code, message, status = 503) => ({ response: { status, data: { success: false, error: { code, message } } } });

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function setup({ onOpenDialog = vi.fn() } = {}) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/portal"]}>
      <ChatWidget onOpenDialog={onOpenDialog} />
      <Where />
    </MemoryRouter>
  );
  return { user, onOpenDialog };
}

const openPanel = (user) => user.click(screen.getByRole("button", { name: "Open assistant chat" }));
const dialog = () => screen.getByRole("dialog", { name: "Assistant chat" });

beforeEach(() => {
  vi.clearAllMocks();
  chatbotApi.suggestions.mockResolvedValue({ data: { data: INTRO } });
  chatbotApi.sendFeedback.mockResolvedValue({});
  chatbotApi.resetConversation.mockResolvedValue({});
});

describe("open and close", () => {
  test("opens from the floating button, shows the server-provided welcome and suggestions, and closes", async () => {
    const { user } = setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openPanel(user);
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close assistant chat" })).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("How can I help you manage your departments and tickets today?")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Tickets" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("focus moves to the input on open, Escape closes, and focus returns to the launcher", async () => {
    const { user } = setup();
    await openPanel(user);
    expect(screen.getByRole("textbox", { name: "Message to the assistant" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open assistant chat" })).toHaveFocus();
  });

  test("the suggestions request carries no role or user information", async () => {
    setup();
    await waitFor(() => expect(chatbotApi.suggestions).toHaveBeenCalledTimes(1));
    expect(chatbotApi.suggestions).toHaveBeenCalledWith();
  });
});

describe("sending messages", () => {
  test("shows the user bubble, a loading indicator, then the assistant reply; sends no role", async () => {
    let resolve;
    chatbotApi.sendMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = setup();
    await openPanel(user);

    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "How do I create a ticket?{Enter}");
    expect(within(dialog()).getByText("How do I create a ticket?")).toBeInTheDocument();
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    resolve(reply({ message: "1. Select Raise a Ticket." }));
    expect(await screen.findByText(/Select Raise a Ticket/)).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();

    // Only the text (and, later, the conversation id) leave the browser.
    expect(chatbotApi.sendMessage).toHaveBeenCalledWith("How do I create a ticket?", null, null);
  });

  test("the follow-up message reuses the conversation id", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openPanel(user);
    const input = screen.getByRole("textbox", { name: "Message to the assistant" });
    await user.type(input, "first{Enter}");
    await screen.findByText("Here you go.");
    await user.type(input, "second{Enter}");
    await waitFor(() => expect(chatbotApi.sendMessage).toHaveBeenCalledTimes(2));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("second", "conv-1", null);
  });

  test("selecting a suggested prompt sends it", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openPanel(user);
    await user.click(await screen.findByRole("button", { name: "Open Tickets" }));
    expect(chatbotApi.sendMessage).toHaveBeenCalledWith("Show open tickets", null, null);
    // Suggestions give way to the conversation.
    await screen.findByText("Here you go.");
    expect(screen.queryByRole("group", { name: "Quick actions" })).not.toBeInTheDocument();
  });

  test("empty input cannot be sent", async () => {
    const { user } = setup();
    await openPanel(user);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "   {Enter}");
    expect(chatbotApi.sendMessage).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  test("shows a friendly error with Retry; retry resends once without duplicating the user bubble", async () => {
    chatbotApi.sendMessage.mockRejectedValueOnce(apiError("CHAT_PROVIDER_UNAVAILABLE", "The assistant is temporarily unavailable. Please try again shortly.")).mockResolvedValueOnce(reply({ message: "Back online." }));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hello{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("temporarily unavailable");
    expect(alert).not.toHaveTextContent(/stack|ECONN|500/i);

    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Back online.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(chatbotApi.sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("hello")).toHaveLength(1);
  });

  test("network failures show a generic retryable message", async () => {
    chatbotApi.sendMessage.mockRejectedValue(new Error("Network Error"));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  test("non-retryable errors (e.g. rate limit is retryable, auth is not) hide Retry", async () => {
    chatbotApi.sendMessage.mockRejectedValue(apiError("CHAT_AUTH_REQUIRED", "Your session has expired. Please sign in again.", 401));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("session has expired");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  test("a failed suggestions load can be retried", async () => {
    chatbotApi.suggestions.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ data: { data: INTRO } });
    const { user } = setup();
    await openPanel(user);
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("How can I help you manage your departments and tickets today?")).toBeInTheDocument();
  });
});

describe("cards and navigation", () => {
  const ticket = {
    ticketRouteId: "cuid-1",
    ticketNumber: "2627001",
    title: "Printer on floor 2",
    status: "IN_PROGRESS",
    statusLabel: "In Progress",
    priority: { name: "High", color: "#ff0000" },
    assignedTo: "Carol",
    lastUpdatedAt: "2026-10-01T10:00:00.000Z",
  };

  test("ticket list card shows number, title, status and priority badges and opens the ticket", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply({ intent: "list_tickets", message: "Open tickets: found 1 ticket.", data: { tickets: [ticket], total: 1 } }));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "Show my open tickets{Enter}");

    const list = await screen.findByRole("list", { name: "Matching tickets" });
    expect(within(list).getByText("#2627001")).toBeInTheDocument();
    expect(within(list).getByText("In Progress")).toBeInTheDocument();
    expect(within(list).getByText("High")).toBeInTheDocument();
    expect(within(list).getByText("Printer on floor 2")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: "Open ticket 2627001" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tickets/cuid-1");
  });

  test("summary card renders missing fields as Not available and separates suggestions from facts", async () => {
    const summary = {
      ticketId: "2627002",
      ticketRouteId: "cuid-2",
      subject: "VPN problem",
      summary: "Cannot connect",
      status: "ON_HOLD",
      priority: "High",
      assignedTo: null,
      department: "IT Support",
      createdAt: "2026-09-20T10:00:00.000Z",
      lastUpdatedAt: "2026-09-22T10:00:00.000Z",
      category: null,
      slaStatus: "Not tracked",
      latestUpdate: null,
      pendingActions: ["No assignee is recorded for this ticket."],
      suggestions: ["A Manager or Team Lead can assign it."],
      resolutionSummary: null,
    };
    chatbotApi.sendMessage.mockResolvedValue(reply({ intent: "summarize_ticket", message: "Ticket 2627002 is On Hold.", data: { summary }, navigationTarget: { type: "route", path: "/tickets/cuid-2", label: "Open ticket" } }));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "Summarize ticket 2627002{Enter}");

    const card = await screen.findByLabelText("Summary of ticket 2627002");
    expect(within(card).getAllByText("Not available").length).toBeGreaterThanOrEqual(3);
    expect(within(card).getByText("Pending (from recorded data)")).toBeInTheDocument();
    expect(within(card).getByText("No assignee is recorded for this ticket.")).toBeInTheDocument();
    expect(within(card).getByText("Suggestion (not a recorded fact)")).toBeInTheDocument();
    expect(within(card).getByText("Not tracked")).toBeInTheDocument();
  });

  test("assistant text is rendered as text, not HTML", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply({ message: "<img src=x onerror=alert(1)> <b>bold</b>" }));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hi{Enter}");
    expect(await screen.findByText(/<img src=x/)).toBeInTheDocument();
    expect(dialog().querySelector("img[src=\"x\"]")).toBeNull();
    expect(dialog().querySelector("b")).toBeNull();
  });

  test("navigation button follows a route target; a dialog target opens the existing dialog", async () => {
    chatbotApi.sendMessage
      .mockResolvedValueOnce(reply({ message: "Steps...", navigationTarget: { type: "route", path: "/portal/new-ticket", label: "Open Raise a Ticket" } }))
      .mockResolvedValueOnce(reply({ message: "Steps...", navigationTarget: { type: "dialog", dialog: "edit-profile", label: "Open password settings" } }));
    const { user, onOpenDialog } = setup();
    await openPanel(user);
    const input = screen.getByRole("textbox", { name: "Message to the assistant" });

    await user.type(input, "create{Enter}");
    await user.click(await screen.findByRole("button", { name: "Open Raise a Ticket" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/new-ticket");

    await user.type(input, "password{Enter}");
    await user.click(await screen.findByRole("button", { name: "Open password settings" }));
    expect(onOpenDialog).toHaveBeenCalledWith("edit-profile");
  });

  test("suggested follow-up actions send their prompt", async () => {
    chatbotApi.sendMessage
      .mockResolvedValueOnce(reply({ suggestedActions: [{ label: "Show ticket history", prompt: "Show history of ticket 2627001" }] }))
      .mockResolvedValueOnce(reply({ message: "History." }));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "x{Enter}");
    await user.click(await screen.findByRole("button", { name: "Show ticket history" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show history of ticket 2627001", "conv-1", null);
  });
});

describe("feedback, copy and reset", () => {
  test("feedback controls submit a rating for the right message", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hi{Enter}");
    await user.click(await screen.findByRole("button", { name: "Mark response as helpful" }));
    expect(chatbotApi.sendFeedback).toHaveBeenCalledWith("msg-1", "helpful");
    expect(await screen.findByText("Thanks for the feedback.")).toBeInTheDocument();
  });

  test("the report menu offers incorrect / unauthorized information / other", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hi{Enter}");
    await user.click(await screen.findByRole("button", { name: "Report a problem with this response" }));
    await user.click(await screen.findByRole("menuitem", { name: "Shows information I should not see" }));
    expect(chatbotApi.sendFeedback).toHaveBeenCalledWith("msg-1", "unauthorized_information");
  });

  test("copy puts the response text on the clipboard", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply({ message: "Copy me" }));
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hi{Enter}");
    await user.click(await screen.findByRole("button", { name: "Copy response" }));
    expect(writeText).toHaveBeenCalledWith("Copy me");
  });

  test("reset clears the conversation, archives it on the server, and restores the suggestions", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hi{Enter}");
    await screen.findByText("Here you go.");

    await user.click(screen.getByRole("button", { name: "Reset conversation" }));
    expect(screen.queryByText("Here you go.")).not.toBeInTheDocument();
    expect(chatbotApi.resetConversation).toHaveBeenCalledWith("conv-1");
    expect(await screen.findByText("How can I help you manage your departments and tickets today?")).toBeInTheDocument();

    // The next message starts a brand-new conversation.
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "again{Enter}");
    await waitFor(() => expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("again", null, null));
  });
});

describe("accessibility", () => {
  test("conversation is a polite live log and status updates are announced", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openPanel(user);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log).toHaveAttribute("aria-live", "polite");

    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hi{Enter}");
    await screen.findByText("Here you go.");
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Assistant replied.")).toBe(true);
  });

  test("everything is reachable and operable by keyboard", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await user.tab(); // launcher
    expect(screen.getByRole("button", { name: "Open assistant chat" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(dialog()).toBeInTheDocument();

    // Tab through: input is focused; reaching a suggestion chip and pressing Enter sends it.
    const chip = await screen.findByRole("button", { name: "Open Tickets" });
    act(() => chip.focus());
    await user.keyboard("{Enter}");
    expect(chatbotApi.sendMessage).toHaveBeenCalledWith("Show open tickets", null, null);
  });
});

describe("mobile layout", () => {
  test("on a phone-width viewport the panel is full screen and the launcher gives way to it", async () => {
    window.__mobile = true;
    const { user } = setup();
    await openPanel(user);
    expect(dialog()).toHaveStyle({ position: "fixed" });
    expect(screen.queryByRole("button", { name: "Close assistant chat" })).not.toBeInTheDocument();
    // Close control inside the panel remains available.
    await user.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open assistant chat" })).toBeInTheDocument();
  });

  test("navigating from the panel closes it on mobile so the destination is visible", async () => {
    window.__mobile = true;
    chatbotApi.sendMessage.mockResolvedValue(reply({ navigationTarget: { type: "route", path: "/portal/my-tickets", label: "Open My Tickets" } }));
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "tickets{Enter}");
    await user.click(await screen.findByRole("button", { name: "Open My Tickets" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/my-tickets");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("admin changes need an explicit confirmation", () => {
  const pending = {
    id: "act-1",
    confirmationToken: "tok-0123456789abcdef",
    title: "Deactivate user",
    summary: "Deactivate Ravi Kumar (Employee).",
    impact: ["Ravi Kumar will be signed out and will not be able to log in.", "You can reactivate them later."],
  };
  const propose = () => chatbotApi.sendMessage.mockResolvedValue(reply({ intent: "admin_action", message: "I can do that. Nothing has been changed yet.", data: { pendingAction: pending } }));
  const ask = async (user) => {
    await openPanel(user);
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "Deactivate user Ravi Kumar{Enter}");
    return screen.findByRole("group", { name: "Proposed change: Deactivate user" });
  };

  test("shows the preview and impact, and calls nothing until Confirm is pressed", async () => {
    propose();
    const { user } = setup();
    const card = await ask(user);
    expect(within(card).getByText("Deactivate Ravi Kumar (Employee).")).toBeInTheDocument();
    expect(within(card).getByText("You can reactivate them later.")).toBeInTheDocument();
    expect(within(card).getByText(/not made yet/)).toBeInTheDocument();
    expect(chatbotApi.confirmAction).not.toHaveBeenCalled();
    expect(chatbotApi.cancelAction).not.toHaveBeenCalled();
  });

  test("Confirm calls the confirm endpoint once and shows the server's real result", async () => {
    propose();
    chatbotApi.confirmAction.mockResolvedValue({ data: { data: { actionId: "act-1", status: "EXECUTED", message: "Ravi Kumar was deactivated." } } });
    const { user } = setup();
    const card = await ask(user);
    await user.click(within(card).getByRole("button", { name: /^Confirm:/ }));
    // The id alone is not enough: the one-time token and the conversation id travel with it.
    expect(chatbotApi.confirmAction).toHaveBeenCalledWith("act-1", "tok-0123456789abcdef", "conv-1");
    expect(await screen.findByText("Ravi Kumar was deactivated.")).toBeInTheDocument();
    expect(within(card).getByText("Done")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  test("Cancel calls the cancel endpoint and never confirm", async () => {
    propose();
    chatbotApi.cancelAction.mockResolvedValue({ data: { data: { actionId: "act-1", status: "CANCELLED", message: "Cancelled. Nothing was changed." } } });
    const { user } = setup();
    const card = await ask(user);
    await user.click(within(card).getByRole("button", { name: "Cancel this change" }));
    expect(chatbotApi.cancelAction).toHaveBeenCalledWith("act-1", "tok-0123456789abcdef", "conv-1");
    expect(chatbotApi.confirmAction).not.toHaveBeenCalled();
    expect(await screen.findByText("Cancelled. Nothing was changed.")).toBeInTheDocument();
    expect(within(card).getByText("Cancelled")).toBeInTheDocument();
  });

  test("a failed change is shown as NOT done", async () => {
    propose();
    chatbotApi.confirmAction.mockResolvedValue({ data: { data: { actionId: "act-1", status: "FAILED", message: "That change wasn't made: You cannot deactivate your own account" } } });
    const { user } = setup();
    const card = await ask(user);
    await user.click(within(card).getByRole("button", { name: /^Confirm:/ }));
    expect(await screen.findByText(/wasn't made/)).toBeInTheDocument();
    expect(within(card).getByText("Not done")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  test("an API error leaves the card actionable and shows a friendly message", async () => {
    propose();
    chatbotApi.confirmAction.mockRejectedValue(apiError("CHAT_ACCESS_DENIED", "Your role doesn't have access to that information.", 403));
    const { user } = setup();
    const card = await ask(user);
    await user.click(within(card).getByRole("button", { name: /^Confirm:/ }));
    expect(await screen.findByText(/role doesn't have access/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /^Confirm:/ })).toBeEnabled();
  });
});

describe("how a request was understood", () => {
  test("shows a small AI note only when the model interpreted the request, and clarification chips send their prompt", async () => {
    chatbotApi.sendMessage
      .mockResolvedValueOnce(reply({ message: "Done.", interpretation: { method: "openrouter", confidence: 0.93 } }))
      .mockResolvedValueOnce(reply({ message: "More than one user matches.", suggestedActions: [{ label: "Sam Smith (Employee, IT)", prompt: "Sam Smith (Employee, IT)" }] }))
      .mockResolvedValueOnce(reply({ message: "Okay." }));
    const { user } = setup();
    await openPanel(user);
    const input = screen.getByRole("textbox", { name: "Message to the assistant" });
    await user.type(input, "something free-form{Enter}");
    expect(await screen.findByText(/Understood with AI/)).toBeInTheDocument();
    await user.type(input, "disable sam{Enter}");
    await user.click(await screen.findByRole("button", { name: "Sam Smith (Employee, IT)" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Sam Smith (Employee, IT)", "conv-1", null);
    expect(screen.getAllByText(/Understood with AI/)).toHaveLength(1);
  });

  test("typing cancel marks the proposal's card as cancelled", async () => {
    chatbotApi.sendMessage
      .mockResolvedValueOnce(reply({ intent: "admin_action", data: { pendingAction: { id: "act-9", confirmationToken: "tok-0123456789abcdef", title: "Deactivate user", summary: "Deactivate Ravi.", impact: ["x"] } } }))
      .mockResolvedValueOnce(reply({ message: "Cancelled. Nothing was changed.", data: { cancelledActionId: "act-9" } }));
    const { user } = setup();
    await openPanel(user);
    const input = screen.getByRole("textbox", { name: "Message to the assistant" });
    await user.type(input, "deactivate ravi{Enter}");
    const card = await screen.findByRole("group", { name: "Proposed change: Deactivate user" });
    await user.type(input, "cancel{Enter}");
    expect(await within(card).findByText("Cancelled")).toBeInTheDocument();
    expect(chatbotApi.cancelAction).not.toHaveBeenCalled();
  });
});

describe("chat history", () => {
  const LIST = { data: { data: { conversations: [
    { conversationId: "conv-a", title: "Show my open tickets", status: "ARCHIVED", lastMessageAt: new Date().toISOString() },
    { conversationId: "conv-b", title: "How do I change my password?", status: "ACTIVE", lastMessageAt: new Date().toISOString() },
  ] } } };

  const openHistory = async (user) => {
    await openPanel(user);
    await user.click(await screen.findByRole("button", { name: "Chat history" }));
  };

  test("lists earlier conversations and reopens one with its messages, ready to continue", async () => {
    chatbotApi.listConversations.mockResolvedValue(LIST);
    chatbotApi.resumeConversation.mockResolvedValue({});
    chatbotApi.getConversation.mockResolvedValue({ data: { data: { conversationId: "conv-a", messages: [
      { id: "m1", sender: "user", text: "Show my open tickets", createdAt: new Date().toISOString() },
      { id: "m2", sender: "assistant", text: "You have 2 open tickets.", data: {}, createdAt: new Date().toISOString() },
    ] } } });
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const { user } = setup();
    await openHistory(user);

    expect(await screen.findByRole("region", { name: "Chat history" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Show my open tickets/ }));
    expect(await screen.findByText("You have 2 open tickets.")).toBeInTheDocument();
    expect(chatbotApi.resumeConversation).toHaveBeenCalledWith("conv-a");

    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "and closed?{Enter}");
    expect(chatbotApi.sendMessage).toHaveBeenCalledWith("and closed?", "conv-a", null);
  });

  test("shows an empty state, and a replayed proposal is not actionable", async () => {
    chatbotApi.listConversations.mockResolvedValue({ data: { data: { conversations: [] } } });
    const { user } = setup();
    await openHistory(user);
    expect(await screen.findByText(/No earlier conversations yet/)).toBeInTheDocument();
  });

  test("deleting asks first, then removes the conversation", async () => {
    // After the delete the page is read again; the server no longer returns the deleted one.
    chatbotApi.listConversations.mockResolvedValueOnce(LIST).mockResolvedValue({ data: { data: { conversations: [LIST.data.data.conversations[0]] } } });
    chatbotApi.deleteConversation.mockResolvedValue({});
    const { user } = setup();
    await openHistory(user);
    await user.click(await screen.findByRole("button", { name: "Delete conversation: How do I change my password?" }));
    expect(chatbotApi.deleteConversation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(chatbotApi.deleteConversation).toHaveBeenCalledWith("conv-b"));
    await waitFor(() => expect(screen.queryByText("How do I change my password?")).not.toBeInTheDocument());
  });
});

describe("editing a proposal", () => {
  test("Edit discards the proposal and puts the original request back in the composer", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply({
      message: "I can do that.",
      data: { pendingAction: { id: "act-1", title: "Rename department", summary: "Rename the department", impact: [], confirmationToken: "t".repeat(20) } },
    }));
    chatbotApi.cancelAction.mockResolvedValue({ data: { data: { status: "CANCELLED", message: "Cancelled." } } });
    const { user } = setup();
    await openPanel(user);
    const input = await screen.findByRole("textbox", { name: "Message to the assistant" });
    await user.type(input, "raise a ticket for laptop{Enter}");
    await user.click(await screen.findByRole("button", { name: "Edit this request" }));
    await waitFor(() => expect(chatbotApi.cancelAction).toHaveBeenCalledTimes(1));
    expect(chatbotApi.confirmAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message to the assistant" })).toHaveValue("raise a ticket for laptop"));
  });
});

describe("after a change is confirmed", () => {
  test("a created ticket result offers a View ticket button that opens it", async () => {
    chatbotApi.sendMessage.mockResolvedValue(reply({
      data: { pendingAction: { id: "act-2", title: "Create ticket", summary: "Raise a ticket", impact: [], confirmationToken: "t".repeat(20) } },
    }));
    chatbotApi.confirmAction.mockResolvedValue({ data: { data: { status: "EXECUTED", message: "Ticket 2600007 was created for Hardware.", navigationTarget: { type: "route", path: "/tickets/abc123", label: "Open Ticket" } } } });
    const { user } = setup();
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "raise a ticket{Enter}");
    await user.click(await screen.findByRole("button", { name: /^Confirm:/ }));
    await user.click(await screen.findByRole("button", { name: "Open Ticket" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tickets/abc123");
  });
});

describe("raising a ticket with files", () => {
  const draft = (over = {}) => ({
    id: "d1", status: "ACTIVE", step: "ATTACH", title: "VPN down", priority: "High", fromDepartment: "IT Support", department: "Finance", cc: [], summary: "Cannot connect.", words: 2, maxWords: 50,
    attachments: [], limits: { maxFiles: 5, maxMb: 10 }, ...over,
  });
  const start = (data = {}) => reply({ message: "Do you want to attach any files?", data: { ticketDraft: draft(), ...data } });
  const png = (name = "shot.png", size = 2048) => new File([new Uint8Array(size)], name, { type: "image/png" });

  async function open(user) {
    chatbotApi.sendMessage.mockResolvedValue(start());
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "raise a ticket{Enter}");
    await screen.findByText("Do you want to attach any files?");
  }

  test("the attach button is only available while a ticket is being raised", async () => {
    const { user } = setup();
    await openPanel(user);
    expect(await screen.findByRole("button", { name: /Attach a file \(available while raising a ticket\)/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "raise a ticket{Enter}");
    chatbotApi.sendMessage.mockResolvedValue(start());
    await user.clear(screen.getByRole("textbox", { name: "Message to the assistant" }));
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "go{Enter}");
    expect(await screen.findByRole("button", { name: "Attach files to the ticket" })).toBeEnabled();
  });

  test("a chosen file is uploaded with the conversation id, shown with a remove button, and can be removed", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    const { user } = setup();
    await open(user);
    chatbotApi.uploadDraftFiles.mockResolvedValue({ data: { data: { messageId: "m9", message: "Added shot.png.", data: { ticketDraft: draft({ attachments: [{ id: "a1", name: "shot.png", size: 2048, mimeType: "image/png" }] }) }, suggestedActions: [] } } });
    await user.upload(screen.getByTestId("ticket-file-input"), png());
    expect(await screen.findByText("Added shot.png.")).toBeInTheDocument();
    const form = chatbotApi.uploadDraftFiles.mock.calls[0][0];
    expect(form.get("conversationId")).toBe("conv-1");
    expect(form.getAll("files")[0].name).toBe("shot.png");
    expect(await screen.findByAltText("Preview of shot.png")).toBeInTheDocument();

    chatbotApi.removeDraftFile.mockResolvedValue({ data: { data: { messageId: "m10", message: "Removed shot.png.", data: { ticketDraft: draft() }, suggestedActions: [] } } });
    await user.click(screen.getByRole("button", { name: "Remove attachment shot.png" }));
    expect(chatbotApi.removeDraftFile).toHaveBeenCalledWith("a1", "conv-1", true);
    expect(await screen.findByText("Removed shot.png.")).toBeInTheDocument();
  });

  test("a pasted screenshot becomes an attachment, not text in the message box", async () => {
    const { user } = setup();
    await open(user);
    chatbotApi.uploadDraftFiles.mockResolvedValue({ data: { data: { messageId: "m9", message: "Added pasted-image.png.", data: { ticketDraft: draft() }, suggestedActions: [] } } });
    const box = screen.getByRole("textbox", { name: "Message to the assistant" });
    const file = png("clip.png");
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
    await waitFor(() => expect(chatbotApi.uploadDraftFiles).toHaveBeenCalledTimes(1));
    expect(chatbotApi.uploadDraftFiles.mock.calls[0][0].getAll("files")[0].name).toMatch(/^pasted-image-\d+\.png$/);
    expect(box).toHaveValue("");
  });

  test("more than 5 files, or more than 10 MB, is refused before upload with the ticket page's wording", async () => {
    const { user } = setup();
    await open(user);
    const six = Array.from({ length: 6 }, (_, i) => png(`f${i}.png`));
    await user.upload(screen.getByTestId("ticket-file-input"), six);
    expect(await screen.findByText(/Maximum 5 attachments are allowed per ticket/)).toBeInTheDocument();
    await user.upload(screen.getByTestId("ticket-file-input"), new File([new Uint8Array(11 * 1024 * 1024)], "huge.png", { type: "image/png" }));
    expect(await screen.findByText(/Attachments cannot exceed 10 MB combined per ticket/)).toBeInTheDocument();
    expect(chatbotApi.uploadDraftFiles).not.toHaveBeenCalled();
  });

  test("a server refusal is shown, and the review has Raise Ticket, Edit and Cancel", async () => {
    const { user } = setup();
    await open(user);
    chatbotApi.uploadDraftFiles.mockRejectedValue(apiError("CHAT_ACTION_INVALID", "Maximum 5 attachments are allowed per ticket.", 400));
    await user.upload(screen.getByTestId("ticket-file-input"), png());
    expect(await screen.findByText("Maximum 5 attachments are allowed per ticket.")).toBeInTheDocument();

    chatbotApi.sendMessage.mockResolvedValue(reply({ message: "Ticket Review", data: { ticketDraft: draft({ step: "REVIEW" }), pendingAction: { id: "act-9", title: "Raise ticket", summary: "Raise the ticket", impact: [], confirmationToken: "t".repeat(20) } } }));
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "no{Enter}");
    expect(await screen.findByRole("button", { name: /^Confirm: Raise the ticket/ })).toHaveTextContent("Raise Ticket");
    chatbotApi.sendMessage.mockResolvedValue(reply({ message: "What would you like to change?" }));
    await user.click(screen.getByRole("button", { name: "Edit this request" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("I want to edit the ticket", "conv-1", null);
    expect(chatbotApi.cancelAction).not.toHaveBeenCalled();
  });
});

describe("the open ticket page", () => {
  test("its id is sent as a hint so 'this ticket' means that ticket", async () => {
    chatbotApi.suggestions.mockResolvedValue({ data: { data: INTRO } });
    chatbotApi.sendMessage.mockResolvedValue(reply());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/tickets/tk_abc123"]}>
        <ChatWidget />
      </MemoryRouter>
    );
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "who raised this ticket?{Enter}");
    await waitFor(() => expect(chatbotApi.sendMessage).toHaveBeenCalledWith("who raised this ticket?", null, "tk_abc123"));
  });
});

describe("recorded reasons", () => {
  test("a ticket list shows each ticket's reason, and a single-ticket answer shows the reasons card", async () => {
    const { user } = setup();
    await openPanel(user);
    chatbotApi.sendMessage.mockResolvedValueOnce(reply({
      message: "Closed tickets: found 1 ticket.",
      data: { tickets: [{ ticketNumber: "2600007", ticketRouteId: "t1", title: "assigning demo laptop", status: "CLOSED", priority: { name: "High", color: "#f00" }, reason: { label: "Closed reason", text: "Duplicate of 2600005" } }], total: 1 },
    }));
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "show me the closed ticket reasons{Enter}");
    expect(await screen.findByText("Closed reason")).toBeInTheDocument();
    expect(screen.getByText("Duplicate of 2600005")).toBeInTheDocument();

    chatbotApi.sendMessage.mockResolvedValueOnce(reply({
      message: "Ticket 2600007 (Closed): the recorded closed reasons are shown below.",
      data: { reasons: [{ label: "Closed reason", text: "Older close: wrong queue", by: "Pavithran M", at: "2026-10-01T10:00:00.000Z", current: false }] },
    }));
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "why was ticket 2600007 closed{Enter}");
    expect(await screen.findByLabelText("Recorded reasons")).toHaveTextContent("Older close: wrong queue");
  });
});

describe("the reference design", () => {
  const tk = (n, over = {}) => ({ ticketNumber: n, ticketRouteId: `r${n}`, title: `Title ${n}`, status: "OPEN", priority: { name: "Medium", color: "#ff0" }, department: "Hardware", assignedTo: "Jamie User", ...over });

  test("the welcome shows the greeting, four quick actions and the unread badge", async () => {
    chatbotApi.suggestions.mockResolvedValue({ data: { data: { ...INTRO, unreadNotifications: 3 } } });
    const { user } = setup();
    await openPanel(user);
    expect(await screen.findByText("Welcome back,")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Quick actions" });
    for (const name of ["My Tickets", "Open Tickets", "Department Tickets", "Notifications"]) expect(within(group).getByRole("button", { name })).toBeInTheDocument();
    expect(within(group).getByLabelText("3 unread")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message to the assistant" })).toHaveAttribute("placeholder", "Ask about tickets, people or departments...");
  });

  test("several tickets are compact rows with a View all row; one ticket is a detail card", async () => {
    chatbotApi.sendMessage.mockResolvedValueOnce(reply({ message: "Your open tickets: found 8 tickets.", data: { tickets: [tk("2600007"), tk("2600005")], total: 8 } }));
    const { user } = setup();
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "show open tickets{Enter}");
    const list = await screen.findByRole("list", { name: "Matching tickets" });
    expect(within(list).getAllByRole("button", { name: /^Open ticket / })).toHaveLength(2);
    await user.click(within(list).getByRole("button", { name: /View all 8 tickets/ }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show more", "conv-1", null);

    chatbotApi.sendMessage.mockResolvedValueOnce(reply({ message: "Your resolved tickets: found 1 ticket.", data: { tickets: [tk("2600003", { status: "RESOLVED", priority: { name: "Low", color: "#0f0" }, createdAt: "2026-09-18T10:00:00.000Z" })], total: 1 } }));
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "resolved tickets{Enter}");
    expect(await screen.findByText("Open Ticket")).toBeInTheDocument();
    expect(screen.getByText("Sep 18, 2026")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  test("a message that was not understood shows its suggestions as buttons, and the replies are signed Solvy", async () => {
    chatbotApi.sendMessage.mockResolvedValueOnce(
      reply({
        message: "I couldn't understand that request.\n\nTry:\n• Show my open tickets\n• Show my resolved tickets\n• Show tickets assigned to me",
        suggestedActions: [{ label: "Show my open tickets", prompt: "Show my open tickets" }, { label: "Show my resolved tickets", prompt: "Show my resolved tickets" }, { label: "Show tickets assigned to me", prompt: "Show tickets assigned to me" }],
        error: { code: "CHAT_UNSUPPORTED_INTENT", message: "x", retryable: false },
      })
    );
    const { user } = setup();
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "asdf{Enter}");
    expect(await screen.findByText("I couldn't understand that request.")).toBeInTheDocument();
    expect(screen.getAllByText("Solvy").length).toBeGreaterThan(1); // the header title and the reply label
    expect(screen.queryByText(/^• Show my open tickets/)).not.toBeInTheDocument();
    chatbotApi.sendMessage.mockResolvedValueOnce(reply());
    await user.click(screen.getByRole("button", { name: "Show my resolved tickets" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show my resolved tickets", "conv-1", null);
  });
});

describe("the role-based home and the info panel", () => {
  test("the quick actions, greeting and 'What I can do' come from the server for the role", async () => {
    chatbotApi.suggestions.mockResolvedValue({
      data: { data: { portal: "Employee Portal", role: "EMPLOYEE", welcomeMessage: "x", suggestions: [], welcomeSubtitle: "How can I help you with your tickets today?", quickActions: [{ label: "My Tickets", prompt: "Show my tickets", icon: "tickets" }, { label: "Raise Ticket", prompt: "Raise a ticket", icon: "raise" }], capabilities: [{ title: "Tickets", items: ["View your tickets"] }, { title: "Guidance", items: ["Ask how to use Solvora"] }] } },
    });
    const { user } = setup();
    await openPanel(user);
    expect(await screen.findByText("How can I help you with your tickets today?")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Quick actions" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(within(group).getByRole("button", { name: "Raise Ticket" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Department Tickets" })).not.toBeInTheDocument();

    chatbotApi.sendMessage.mockResolvedValueOnce(reply());
    await user.click(within(group).getByRole("button", { name: "Raise Ticket" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Raise a ticket", null, null);
  });

  test("the Info button opens 'What I can do' with this role's capabilities", async () => {
    const { user } = setup();
    await openPanel(user);
    await screen.findByText("How can I help you manage your departments and tickets today?");
    await user.click(screen.getByRole("button", { name: "What I can do" }));
    const panel = await screen.findByRole("dialog", { name: "What I can do" });
    expect(within(panel).getByText("What I can do")).toBeInTheDocument();
    expect(within(panel).getByText("View tickets in your authorized departments")).toBeInTheDocument();
    expect(within(panel).getByText("View your notifications")).toBeInTheDocument();
  });
});

describe("What's New today on the home", () => {
  test("a centred button under the greeting sends the what's-new question", async () => {
    chatbotApi.suggestions.mockResolvedValue({ data: { data: { ...INTRO, whatsNew: { label: "What's New today", prompt: "What's new today" } } } });
    const { user } = setup();
    await openPanel(user);
    const button = await screen.findByRole("button", { name: "What's New today" });
    expect(screen.getByText("How can I help you manage your departments and tickets today?").compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    chatbotApi.sendMessage.mockResolvedValueOnce(reply());
    await user.click(button);
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("What's new today", null, null);
  });
});

describe("the single ticket session: one form, one review, one Raise Ticket", () => {
  const OPTIONS = { priorities: ["Low", "High"], departments: ["Hardware", "BI/Copilot"] };
  const formDraft = (over = {}) => ({
    id: "d1", status: "ACTIVE", step: "TITLE", title: null, priority: null, fromDepartment: null, department: null, cc: [], ccUsers: [], summary: null, words: 0, maxWords: 50,
    attachments: [], limits: { maxFiles: 5, maxMb: 10 }, options: OPTIONS, ...over,
  });
  const image = (name = "shot.png", size = 2048) => new File([new Uint8Array(size)], name, { type: "image/png" });
  const att = (id, name, size = 2048, mimeType = "image/png") => ({ id, name, size, mimeType });

  async function openForm(user, draft = formDraft()) {
    chatbotApi.sendMessage.mockResolvedValueOnce(reply({ intent: "ticket_draft", message: "Sure. Fill in the form below.", data: { ticketDraft: draft } }));
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "raise a ticket{Enter}");
    return screen.findByRole("form", { name: "Raise a ticket form" });
  }
  const fill = async (user, form, { title = "VPN down", priority = "High", department = "Hardware", summary = "Cannot connect." } = {}) => {
    await user.type(within(form).getByLabelText(/^Title/), title);
    await user.selectOptions(within(form).getByLabelText(/^Priority/), priority);
    await user.selectOptions(within(form).getByLabelText(/^Department/), department);
    await user.type(within(form).getByLabelText(/^Problem Summary/), summary);
  };
  const reviewReply = (over = {}) =>
    reply({
      intent: "ticket_draft",
      message: "Ticket Review\n\nTitle: VPN down",
      data: { ticketDraft: formDraft({ step: "REVIEW", options: undefined, title: "VPN down", priority: "High", department: "Hardware", summary: "Cannot connect." }), pendingAction: { id: "act-1", title: "Raise ticket", summary: 'Raise the ticket "VPN down" to Hardware with High priority.', impact: [], confirmationToken: "t".repeat(20) } },
      ...over,
    });

  test("the form has every field, an attachments section and a CC picker, and one primary button", async () => {
    const { user } = setup();
    const form = await openForm(user);
    for (const label of [/^Title/, /^Priority/, /^Department/, /^Problem Summary/, /^Add people in CC/]) expect(within(form).getByLabelText(label)).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: "Attachments" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Add files" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Review Ticket" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Create Ticket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Raise Ticket/ })).not.toBeInTheDocument(); // only the review can raise
  });

  test("Review Ticket sends every field once; the server's review replaces the form", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.reviewDraft.mockResolvedValue(reviewReply());
    const button = within(form).getByRole("button", { name: "Review Ticket" });
    await user.dblClick(button);
    expect(chatbotApi.reviewDraft).toHaveBeenCalledTimes(1);
    expect(chatbotApi.reviewDraft).toHaveBeenCalledWith({ conversationId: "conv-1", title: "VPN down", priority: "High", department: "Hardware", problemSummary: "Cannot connect.", ccUserIds: [] });
    expect(await screen.findByText(/Ticket Review/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Raise a ticket form" })).not.toBeInTheDocument(); // one form only, never a second copy
    expect(screen.getByRole("button", { name: /^Confirm: Raise the ticket/ })).toHaveTextContent("Raise Ticket");
  });

  test("a refusal is shown next to the form and everything typed is kept", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.reviewDraft.mockRejectedValue(apiError("CHAT_ACTION_INVALID", "The problem summary is limited to 50 words.", 422));
    await user.click(within(form).getByRole("button", { name: "Review Ticket" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("limited to 50 words");
    expect(within(form).getByLabelText(/^Title/)).toHaveValue("VPN down");
    expect(within(form).getByLabelText(/^Problem Summary/)).toHaveValue("Cannot connect.");
    expect(within(form).getByRole("button", { name: "Review Ticket" })).toBeEnabled(); // a retry is possible
  });

  test("files are added in place: the list updates, typed text stays, no chat message is added", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.uploadDraftFiles.mockResolvedValue({ data: { data: { quiet: true, data: { ticketDraft: formDraft({ title: "VPN down", attachments: [att("a1", "shot.png")] }) } } } });
    await user.upload(within(form).getByTestId("form-file-input"), image());
    const sent = chatbotApi.uploadDraftFiles.mock.calls[0][0];
    expect(sent.get("conversationId")).toBe("conv-1");
    expect(sent.get("quiet")).toBe("1");
    expect(sent.getAll("files")[0].name).toBe("shot.png");
    expect(await within(form).findByText("shot.png")).toBeInTheDocument();
    expect(within(form).getByText(/1\/5 · 2 KB of 10 MB/)).toBeInTheDocument();
    expect(await within(form).findByAltText("Preview of shot.png")).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Title/)).toHaveValue("VPN down");
    expect(screen.queryByText(/Added shot.png/)).not.toBeInTheDocument();
  });

  test("Ctrl+V of an image attaches it and never puts it in the summary", async () => {
    const { user } = setup();
    const form = await openForm(user);
    chatbotApi.uploadDraftFiles.mockResolvedValue({ data: { data: { quiet: true, data: { ticketDraft: formDraft({ attachments: [att("a2", "pasted-image-1.png")] }) } } } });
    const summary = within(form).getByLabelText(/^Problem Summary/);
    fireEvent.paste(summary, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image("clip.png") }] } });
    await waitFor(() => expect(chatbotApi.uploadDraftFiles).toHaveBeenCalledTimes(1));
    expect(chatbotApi.uploadDraftFiles.mock.calls[0][0].getAll("files")[0].name).toMatch(/^pasted-image-\d+\.png$/);
    expect(summary).toHaveValue("");
    expect(await within(form).findByText("pasted-image-1.png")).toBeInTheDocument();
  });

  test("a sixth file or a file over the combined 10 MB is refused before upload; a repeated file is not added twice", async () => {
    const { user } = setup();
    const five = Array.from({ length: 5 }, (_, i) => att(`a${i}`, `f${i}.png`));
    const form = await openForm(user, formDraft({ attachments: five }));
    await user.upload(within(form).getByTestId("form-file-input"), image("six.png"));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/Maximum 5 attachments/);
    await user.upload(within(form).getByTestId("form-file-input"), image("f0.png")); // same name and size as one already attached
    expect(await within(form).findByRole("alert")).toHaveTextContent(/already attached|Maximum 5/);
    expect(chatbotApi.uploadDraftFiles).not.toHaveBeenCalled();
  });

  test("a failed upload is reported next to the files and the rest of the form is untouched", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.uploadDraftFiles.mockRejectedValue(apiError("CHAT_ACTION_INVALID", "That file type is not allowed.", 400));
    await user.upload(within(form).getByTestId("form-file-input"), image());
    expect(await within(form).findByRole("alert")).toHaveTextContent("That file type is not allowed.");
    expect(within(form).getByLabelText(/^Title/)).toHaveValue("VPN down");
    chatbotApi.uploadDraftFiles.mockResolvedValue({ data: { data: { quiet: true, data: { ticketDraft: formDraft({ attachments: [att("a1", "shot.png")] }) } } } });
    await user.upload(within(form).getByTestId("form-file-input"), image()); // retry works
    expect(await within(form).findByText("shot.png")).toBeInTheDocument();
  });

  test("a file can be opened in a new tab and removed; the temporary preview is released", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ location: {}, close: vi.fn() });
    const { user } = setup();
    const form = await openForm(user);
    chatbotApi.uploadDraftFiles.mockResolvedValue({ data: { data: { quiet: true, data: { ticketDraft: formDraft({ attachments: [att("a1", "shot.png")] }) } } } });
    await user.upload(within(form).getByTestId("form-file-input"), image());
    await within(form).findByText("shot.png");
    await user.click(within(form).getByRole("button", { name: "Open attachment shot.png" }));
    expect(open).toHaveBeenCalledWith("blob:preview", "_blank");
    chatbotApi.removeDraftFile.mockResolvedValue({ data: { data: { quiet: true, data: { ticketDraft: formDraft() } } } });
    await user.click(within(form).getByRole("button", { name: "Remove attachment shot.png" }));
    expect(chatbotApi.removeDraftFile).toHaveBeenCalledWith("a1", "conv-1", true);
    await waitFor(() => expect(within(form).queryByText("shot.png")).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    open.mockRestore();
  });

  test("a file chosen earlier (no local copy) is fetched and opened from the server", async () => {
    URL.createObjectURL = vi.fn(() => "blob:from-server");
    const tab = { location: {}, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab);
    chatbotApi.fetchDraftFile.mockResolvedValue({ data: new Blob(["x"], { type: "application/pdf" }) });
    const { user } = setup();
    const form = await openForm(user, formDraft({ attachments: [att("a9", "spec.pdf", 5000, "application/pdf")] }));
    await user.click(within(form).getByRole("button", { name: "Open attachment spec.pdf" }));
    await waitFor(() => expect(chatbotApi.fetchDraftFile).toHaveBeenCalledWith("a9", "conv-1"));
    await waitFor(() => expect(tab.location.href).toBe("blob:from-server"));
    open.mockRestore();
  });

  test("CC people: search, pick several, remove one, and send only their ids", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.searchDraftCc.mockImplementation(async (_conv, q) => ({ data: { data: { users: q === "bo" ? [{ id: "u2", name: "Bob Lee", email: "bob@x.test", department: "IT" }] : [{ id: "u3", name: "Bola Ade", email: "bola@x.test", department: null }, { id: "u2", name: "Bob Lee", email: "bob@x.test", department: "IT" }] } } }));
    await user.type(within(form).getByLabelText(/^Add people in CC/), "bo");
    await user.click(await within(form).findByRole("button", { name: /Bob Lee/ }));
    expect(chatbotApi.searchDraftCc).toHaveBeenCalledWith("conv-1", "bo");
    await user.type(within(form).getByLabelText(/^Add people in CC/), "bol");
    await user.click(await within(form).findByRole("button", { name: /Bola Ade/ }));
    const chips = within(form).getByRole("list", { name: "Selected CC people" });
    expect(within(chips).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(form).getByRole("button", { name: "Remove Bob Lee from CC" }));
    expect(within(chips).getAllByRole("listitem")).toHaveLength(1);
    chatbotApi.reviewDraft.mockResolvedValue(reviewReply());
    await user.click(within(form).getByRole("button", { name: "Review Ticket" }));
    expect(chatbotApi.reviewDraft.mock.calls[0][0].ccUserIds).toEqual(["u3"]);
  });

  test("Edit on the review brings the form back with everything that was entered", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.reviewDraft.mockResolvedValue(reviewReply());
    await user.click(within(form).getByRole("button", { name: "Review Ticket" }));
    await screen.findByText(/Ticket Review/);
    chatbotApi.sendMessage.mockResolvedValueOnce(
      reply({ intent: "ticket_draft", message: "Okay, edit your ticket in the form below. Everything you entered is kept.", data: { ticketDraft: formDraft({ step: "FORM", title: "VPN down", priority: "High", department: "Hardware", summary: "Cannot connect.", ccUsers: [{ id: "u2", name: "Bob Lee", email: "bob@x.test" }], attachments: [att("a1", "shot.png")] }) } })
    );
    await user.click(screen.getByRole("button", { name: "Edit this request" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("I want to edit the ticket", "conv-1", null);
    const again = await screen.findByRole("form", { name: "Raise a ticket form" });
    expect(within(again).getByLabelText(/^Title/)).toHaveValue("VPN down");
    expect(within(again).getByLabelText(/^Priority/)).toHaveValue("High");
    expect(within(again).getByLabelText(/^Department/)).toHaveValue("Hardware");
    expect(within(again).getByLabelText(/^Problem Summary/)).toHaveValue("Cannot connect.");
    expect(within(again).getByText("Bob Lee")).toBeInTheDocument();
    expect(within(again).getByText("shot.png")).toBeInTheDocument();
    expect(chatbotApi.confirmAction).not.toHaveBeenCalled();
  });

  test("Cancel asks first when something would be lost, and cancels at once when the form is empty", async () => {
    const { user } = setup();
    const form = await openForm(user);
    chatbotApi.sendMessage.mockResolvedValue(reply({ message: "Okay, I've cancelled the ticket. Nothing was created.", data: { ticketDraftClosed: true } }));
    await user.type(within(form).getByLabelText(/^Title/), "VPN down");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(chatbotApi.sendMessage).toHaveBeenCalledTimes(1); // only "raise a ticket": nothing sent yet
    await user.click(within(form).getByRole("button", { name: "Keep editing" }));
    expect(within(form).getByLabelText(/^Title/)).toHaveValue("VPN down");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    await user.click(within(form).getByRole("button", { name: "Yes, discard" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("cancel", "conv-1", null);
  });

  test("Raise Ticket is the one creating action; success shows the real ticket number and Open Ticket", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.reviewDraft.mockResolvedValue(reviewReply());
    await user.click(within(form).getByRole("button", { name: "Review Ticket" }));
    chatbotApi.confirmAction.mockResolvedValue({ data: { data: { status: "EXECUTED", message: "Your ticket has been raised successfully. Ticket number: 2600099.", navigationTarget: { type: "route", path: "/tickets/id_1", label: "Open Ticket" } } } });
    const raise = await screen.findByRole("button", { name: /^Confirm: Raise the ticket/ });
    await user.dblClick(raise);
    expect(chatbotApi.confirmAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Ticket number: 2600099/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Ticket" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tickets/id_1");
    // The finished ticket leaves no editable form behind.
    expect(screen.queryByRole("form", { name: "Raise a ticket form" })).not.toBeInTheDocument();
  });

  test("a failed Raise Ticket is reported honestly, never as success", async () => {
    const { user } = setup();
    const form = await openForm(user);
    await fill(user, form);
    chatbotApi.reviewDraft.mockResolvedValue(reviewReply());
    await user.click(within(form).getByRole("button", { name: "Review Ticket" }));
    chatbotApi.confirmAction.mockResolvedValue({ data: { data: { status: "FAILED", message: "No ticket was created. Invalid department" } } });
    await user.click(await screen.findByRole("button", { name: /^Confirm: Raise the ticket/ }));
    expect(await screen.findByText("No ticket was created. Invalid department")).toBeInTheDocument();
    expect(screen.queryByText(/raised successfully/)).not.toBeInTheDocument();
  });
});

describe("discarding a reviewed ticket", () => {
  test("Cancel on the review asks first; only 'Yes, discard' cancels the pending ticket", async () => {
    chatbotApi.sendMessage.mockResolvedValueOnce(
      reply({ intent: "ticket_draft", message: "Ticket Review", data: { pendingAction: { id: "act-5", title: "Raise ticket", summary: 'Raise the ticket "VPN down" to Hardware.', impact: [], confirmationToken: "t".repeat(20) } } })
    );
    const { user } = setup();
    await openPanel(user);
    await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), "raise a ticket{Enter}");
    await user.click(await screen.findByRole("button", { name: "Cancel this change" }));
    expect(chatbotApi.cancelAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: /^Confirm: Raise the ticket/ })).toBeInTheDocument();
    chatbotApi.cancelAction.mockResolvedValue({ data: { data: { status: "CANCELLED", message: "Cancelled. Nothing was changed." } } });
    await user.click(screen.getByRole("button", { name: "Cancel this change" }));
    await user.click(screen.getByRole("button", { name: "Yes, discard" }));
    expect(chatbotApi.cancelAction).toHaveBeenCalledTimes(1);
    expect(chatbotApi.confirmAction).not.toHaveBeenCalled();
  });
});
