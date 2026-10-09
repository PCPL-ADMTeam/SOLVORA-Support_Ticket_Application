import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../../api/chatbot", () => ({
  chatbotApi: {
    suggestions: vi.fn(),
    sendMessage: vi.fn(),
    resetConversation: vi.fn(),
    sendFeedback: vi.fn(),
    listConversations: vi.fn(),
  },
}));

import { chatbotApi } from "../../../api/chatbot";
import ChatWidget from "../ChatWidget";

// How Solvy's answers are laid out: the What's New digest, the ticket summary, ticket lists, people
// and departments, notifications, refusals and "not understood". The data comes from the server
// (mocked here); these tests check that it is shown completely, readably and only as text.

const INTRO = { portal: "Employee Portal", role: "EMPLOYEE", welcomeMessage: "Hi!", suggestions: [], welcomeSubtitle: "How can I help you with your tickets today?", quickActions: [], capabilities: [] };
const reply = (over = {}) => ({ data: { data: { conversationId: "conv-1", messageId: "msg-1", message: "Here you go.", intent: "x", data: {}, suggestedActions: [], navigationTarget: null, error: null, ...over } } });
const ticket = (n, over = {}) => ({ ticketRouteId: `id_${n}`, ticketNumber: String(n), title: `Ticket ${n}`, status: "OPEN", statusLabel: "Open", priority: { name: "High", color: "#f00" }, department: "IT Support", assignedTo: "Carol Worker", raisedBy: "Alice Employee", createdAt: "2026-10-01T10:00:00.000Z", lastUpdatedAt: "2026-10-09T10:00:00.000Z", ...over });
const PERIOD = { label: "Today", rangeText: "Oct 9, 2026", from: "2026-10-08T18:30:00.000Z", to: "2026-10-09T10:00:00.000Z", timeZone: "Asia/Kolkata" };

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function setup() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/portal"]}>
      <ChatWidget />
      <Where />
    </MemoryRouter>
  );
  return { user };
}

async function ask(user, text, response) {
  chatbotApi.sendMessage.mockResolvedValueOnce(response);
  if (!screen.queryByRole("dialog")) await user.click(screen.getByRole("button", { name: "Open assistant chat" }));
  await user.type(await screen.findByRole("textbox", { name: "Message to the assistant" }), `${text}{Enter}`);
  await waitFor(() => expect(screen.queryByText("Thinking…")).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  chatbotApi.suggestions.mockResolvedValue({ data: { data: INTRO } });
});

describe("What's New", () => {
  const digest = {
    period: PERIOD,
    notifications: { unread: 3, inPeriod: 2, inPeriodCapped: false, latest: [{ title: "Status changed", message: "Now In Progress", ticketNumber: "2627001", ticketRouteId: "id_2627001", at: "2026-10-09T09:00:00.000Z", isRead: false }] },
    assigned: { count: 1, tickets: [ticket(2627001, { title: "Printer is broken" })] },
    updated: { label: "Your tickets", count: 4, tickets: [ticket(2627004, { title: "Laptop request" })], skippedAssigned: true },
    created: null,
    unassigned: null,
    caughtUp: false,
  };

  test("shows sections with counts, the period, ticket cards and actions", async () => {
    const { user } = setup();
    await ask(user, "What's new today", reply({ message: "What's New — Today (Oct 9, 2026)\n\nNotifications\n• Unread (any date): 3", data: { digest, headline: "Here's what's new today." } }));
    const card = screen.getByRole("region", { name: "What's New" });
    expect(screen.getByText("Here's what's new today.")).toBeInTheDocument();
    // The prose copy of the numbers is not repeated in the bubble.
    expect(screen.queryByText(/Unread \(any date\): 3/)).not.toBeInTheDocument();
    expect(within(card).getByText("Today · Oct 9, 2026")).toBeInTheDocument();

    const notes = within(card).getByRole("region", { name: "Notifications" });
    expect(within(notes).getByText("Unread notifications")).toBeInTheDocument();
    expect(within(notes).getByText("(any date)")).toBeInTheDocument();
    expect(within(notes).getByText("New today")).toBeInTheDocument();
    expect(within(notes).getByText("3")).toBeInTheDocument();

    const assigned = within(card).getByRole("region", { name: "Assigned to You" });
    expect(within(assigned).getByText("Printer is broken")).toBeInTheDocument();
    const mine = within(card).getByRole("region", { name: "Your tickets" });
    expect(within(mine).getByText("Laptop request")).toBeInTheDocument();
    expect(within(mine).getByText(/tickets listed under Assigned to You are not repeated/)).toBeInTheDocument();

    await user.click(within(assigned).getByRole("button", { name: "Open ticket 2627001" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tickets/id_2627001");
  });

  test("View Notifications asks for the notifications through the chat", async () => {
    const { user } = setup();
    await ask(user, "What's new today", reply({ data: { digest, headline: "Here's what's new today." } }));
    chatbotApi.sendMessage.mockResolvedValueOnce(reply({ message: "Notifications." }));
    await user.click(screen.getByRole("button", { name: "View Notifications" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show unread notifications", "conv-1", null);
  });

  test("with no activity it says 'all caught up' instead of zeros", async () => {
    const { user } = setup();
    await ask(user, "What's new today", reply({ data: { headline: "You're all caught up for today.", digest: { ...digest, notifications: { unread: 0, inPeriod: 0, latest: [] }, assigned: { count: 0, tickets: [] }, updated: { label: "Your tickets", count: 0, tickets: [] }, caughtUp: true } } }));
    const card = screen.getByRole("region", { name: "What's New" });
    expect(within(card).getByText("You're all caught up.")).toBeInTheDocument();
    expect(within(card).getByText("No ticket updates today and no unread notifications.")).toBeInTheDocument();
    expect(within(card).queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument();
  });
});

describe("ticket summary", () => {
  const section = (key, label, total, counts, prio) => ({
    key,
    label,
    total,
    byStatus: ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"].map((s, i) => ({ status: s, label: ["Open", "In Progress", "On Hold", "Resolved", "Closed", "Reopened"][i], count: counts[i] })),
    byPriority: [{ priority: "Low", count: prio[0] }, { priority: "High", count: prio[1] }],
  });

  test("raised-by and assigned-to are separate sections; zero is shown as such; priorities stay per section", async () => {
    const report = { title: "Your Ticket Summary", period: { label: "Last 7 days", rangeText: "Oct 2 – Oct 9, 2026" }, sections: [section("created", "Raised by you", 2, [1, 1, 0, 0, 0, 0], [0, 2]), section("assigned", "Assigned to you", 0, [0, 0, 0, 0, 0, 0], [0, 0])] };
    const { user } = setup();
    await ask(user, "my summary for the last 7 days", reply({ message: "Your ticket summary — Last 7 days (Oct 2 – Oct 9, 2026)\n\nRaised by you: 2\n• Status: Open 1 · In Progress 1", data: { summaryReport: report, headline: "Here's your ticket summary for the last 7 days." }, navigationTarget: { type: "route", path: "/portal", label: "View Dashboard" } }));
    const card = screen.getByRole("region", { name: "Your Ticket Summary" });
    expect(within(card).getByText("Last 7 days · Oct 2 – Oct 9, 2026")).toBeInTheDocument();
    const raised = within(card).getByRole("region", { name: "Raised by you" });
    const tiles = within(raised).getByRole("list", { name: "Raised by you by status" });
    expect(within(tiles).getAllByRole("listitem")).toHaveLength(6);
    expect(within(tiles).getByText("Reopened")).toBeInTheDocument();
    expect(within(card).getByRole("region", { name: "Assigned to you" })).toHaveTextContent("No tickets in this period.");
    const prio = within(card).getByRole("region", { name: "Priority Breakdown" });
    expect(within(prio).getByRole("list", { name: "Raised by you by priority" })).toHaveTextContent("High2");
    expect(within(prio).getByRole("list", { name: "Assigned to you by priority" })).toHaveTextContent("High0");
    await user.click(screen.getByRole("button", { name: "View Dashboard" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal");
  });
});

describe("ticket lists", () => {
  test("zero results: a clear 'no results' answer with ways to widen the search", async () => {
    const { user } = setup();
    await ask(user, "show resolved tickets", reply({ message: "I couldn't find any resolved tickets. You can widen the search:", error: { code: "CHAT_NO_RESULTS", message: "x", retryable: false }, suggestedActions: [{ label: "Recently updated tickets", prompt: "Show recently updated tickets" }] }));
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByText(/I couldn't find any resolved tickets/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently updated tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Matching tickets" })).not.toBeInTheDocument();
  });

  test("one result: a full card with every available field and an Open Ticket button", async () => {
    const { user } = setup();
    await ask(user, "show ticket 2627001", reply({ message: "Ticket 2627001:", data: { tickets: [ticket(2627001)], total: 1 } }));
    const list = screen.getByRole("list", { name: "Matching tickets" });
    for (const text of ["#2627001", "Ticket 2627001", "IT Support", "Carol Worker", "Oct 1, 2026", "Oct 9, 2026", "Open", "High"]) expect(within(list).getAllByText(text).length).toBeGreaterThan(0);
    expect(within(list).getByRole("button", { name: "Open ticket 2627001" })).toBeInTheDocument();
  });

  test("several results: compact rows with dates, the filters in force and the range shown", async () => {
    const { user } = setup();
    const tickets = [ticket(1), ticket(2), ticket(3)];
    await ask(user, "show my open tickets", reply({ message: "Your open tickets: found 7 tickets. Showing 1–3 of 7.", data: { tickets, total: 7, listing: { showing: "1–3 of 7", filters: ["Open (all active statuses)", "High priority"], notes: ["\"Open\" includes Open, In Progress, On Hold and Reopened."] }, headline: "Your open tickets: 7 tickets found." } }));
    expect(screen.getByText("Your open tickets: 7 tickets found.")).toBeInTheDocument();
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(within(filters).getByText("High priority")).toBeInTheDocument();
    expect(within(filters).getByText("Showing 1–3 of 7")).toBeInTheDocument();
    expect(screen.getByText("\"Open\" includes Open, In Progress, On Hold and Reopened.")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Matching tickets" })).getAllByRole("button", { name: /^Open ticket / });
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Created Oct 1, 2026 · Updated Oct 9, 2026")).toBeInTheDocument();
    chatbotApi.sendMessage.mockResolvedValueOnce(reply());
    await user.click(screen.getByRole("button", { name: /View all 7 tickets/ }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show more", "conv-1", null);
  });

  test("long titles and missing optional fields still render cleanly", async () => {
    const long = "A very long ticket title ".repeat(12).trim();
    const { user } = setup();
    await ask(user, "show tickets", reply({ message: "Tickets: found 2 tickets.", data: { tickets: [ticket(1, { title: long, department: null, assignedTo: null, createdAt: null, lastUpdatedAt: null, priority: null }), ticket(2)], total: 2 } }));
    const first = screen.getByRole("button", { name: "Open ticket 1" });
    expect(within(first).getByText(long)).toBeInTheDocument();
    expect(within(first).getByText("Unassigned")).toBeInTheDocument();
    expect(within(first).queryByText(/Created|Updated/)).not.toBeInTheDocument();
    expect(first.textContent).not.toMatch(/null|undefined/);
  });
});

describe("people, departments and notifications", () => {
  test("department members: names and roles per department, with counts", async () => {
    const { user } = setup();
    await ask(user, "who works in IT Support", reply({ message: "IT Support - 3 people\n  • Tina Lead — Team Lead", data: { headline: "IT Support: 3 people.", departmentMembers: [{ name: "IT Support", total: 3, members: [{ name: "Tina Lead", role: "Team Lead" }, { name: "Alice Employee", role: "Employee" }, { name: "Bob Employee", role: "Employee" }] }] } }));
    const card = screen.getByRole("region", { name: "People" });
    const list = within(card).getByRole("list", { name: "People in IT Support" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("Tina Lead")).toBeInTheDocument();
    expect(within(list).getByText("Team Lead")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/@/);
  });

  test("a person: name, role and department only", async () => {
    const { user } = setup();
    await ask(user, "show employee Jamie", reply({ message: "Jamie Doe is an Employee in Finance. What would you like to know about Jamie Doe?", data: { headline: "What would you like to know about Jamie Doe?", person: { name: "Jamie Doe", role: "Employee", department: "Finance", active: true } } }));
    const card = screen.getByRole("region", { name: "About Jamie Doe" });
    expect(within(card).getByText("Employee")).toBeInTheDocument();
    expect(within(card).getByText("Finance")).toBeInTheDocument();
  });

  test("department list: one chip per department", async () => {
    const { user } = setup();
    await ask(user, "show departments", reply({ message: "You have access to 2 departments: Finance, IT Support.", data: { headline: "You have access to 2 departments:", departments: ["Finance", "IT Support"] } }));
    expect(within(screen.getByRole("list", { name: "Departments" })).getAllByRole("listitem")).toHaveLength(2);
  });

  test("notifications: unread marked, type, ticket, message and time; Open Ticket only where allowed", async () => {
    const items = [
      { id: "n1", type: "STATUS_CHANGED", title: "Status changed", message: "Ticket 2627001 is now In Progress", isRead: false, at: new Date().toISOString(), ticketNumber: "2627001", ticketRouteId: "id_2627001" },
      { id: "n2", type: "TICKET_MOVED", title: "Moved", message: "Ticket moved", isRead: true, at: new Date().toISOString(), ticketNumber: "2627003", ticketRouteId: null },
    ];
    const { user } = setup();
    await ask(user, "show my notifications", reply({ message: "2 notifications. 1 unread in total.", data: { headline: "2 notifications.", notifications: { unread: 1, shown: 2, matching: 2, items } } }));
    const card = screen.getByRole("region", { name: "Notifications" });
    expect(within(card).getByText("1 unread")).toBeInTheDocument();
    const first = within(card).getByRole("listitem", { name: "Unread: Status changed" });
    expect(within(first).getByText("Status changed", { selector: "p" })).toBeInTheDocument();
    expect(within(first).getByText("#2627001")).toBeInTheDocument();
    expect(within(first).getByText("Ticket 2627001 is now In Progress")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Open ticket 2627001" })).toBeInTheDocument();
    const second = within(card).getByRole("listitem", { name: "Moved" });
    expect(within(second).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("refusals, 'not understood' and plain text", () => {
  test("access denied is labelled, explains the role's limit, and offers queries that work", async () => {
    const { user } = setup();
    await ask(user, "show finance tickets", reply({ message: "I don't have access to that information from your Employee portal. I can help with your own tickets and tickets assigned to you.\n\nTry:\n• Show my tickets\n• Show tickets assigned to me", error: { code: "CHAT_ACCESS_DENIED", message: "x", retryable: false }, suggestedActions: [{ label: "Show my tickets", prompt: "Show my tickets" }, { label: "Show tickets assigned to me", prompt: "Show tickets assigned to me" }] }));
    expect(screen.getByText("Not available for your role")).toBeInTheDocument();
    expect(screen.queryByText("• Show my tickets")).not.toBeInTheDocument();
    chatbotApi.sendMessage.mockResolvedValueOnce(reply());
    await user.click(screen.getByRole("button", { name: "Show tickets assigned to me" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show tickets assigned to me", "conv-1", null);
  });

  test("a request that was not understood offers clickable suggestions", async () => {
    const { user } = setup();
    await ask(user, "flibbertigibbet", reply({ message: "I'm not sure what you're looking for.\n\nTry:\n• Show my open tickets\n• Show my unread notifications\n• Show resolved tickets from the last 7 days", error: { code: "CHAT_UNSUPPORTED_INTENT", message: "x", retryable: false }, suggestedActions: ["Show my open tickets", "Show my unread notifications", "Show resolved tickets from the last 7 days"].map((p) => ({ label: p, prompt: p })) }));
    expect(screen.getByText("Not understood")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Suggested questions" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    chatbotApi.sendMessage.mockResolvedValueOnce(reply());
    await user.click(within(group).getByRole("button", { name: "Show my unread notifications" }));
    expect(chatbotApi.sendMessage).toHaveBeenLastCalledWith("Show my unread notifications", "conv-1", null);
  });

  test("steps and bullets become real lists; markup in text stays text", async () => {
    const { user } = setup();
    await ask(user, "how do I raise a ticket", reply({ message: "Raise a ticket:\n1. Open Raise a Ticket.\n2. Fill in the form.\n\nNotes:\n• <b>bold</b> is not HTML\n• <img src=x onerror=alert(1)>" }));
    const bubble = screen.getByText("Raise a ticket:").parentElement;
    const [steps, bullets] = within(bubble).getAllByRole("list");
    expect(steps.tagName).toBe("OL");
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Open Raise a Ticket.", "Fill in the form."]);
    expect(bullets.tagName).toBe("UL");
    expect(within(bullets).getByText("<b>bold</b> is not HTML")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  test("Copy copies the full answer, not only the headline shown above a card", async () => {
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const full = "Your ticket summary — Last 30 days (Sep 9 – Oct 9, 2026)\n\nRaised by you: 2";
    await ask(user, "my summary", reply({ message: full, data: { headline: "Here's your ticket summary for the last 30 days.", summaryReport: { title: "Your Ticket Summary", period: { label: "Last 30 days" }, sections: [{ key: "created", label: "Raised by you", total: 0, byStatus: [], byPriority: [] }] } } }));
    await user.click(screen.getByRole("button", { name: "Copy response" }));
    expect(writeText).toHaveBeenCalledWith(full);
  });
});

describe("narrow screens", () => {
  test("cards are limited to the bubble width, wrap long words, and tile grids shrink to one column", async () => {
    const { user } = setup();
    await ask(user, "my summary", reply({ data: { summaryReport: { title: "Your Ticket Summary", period: { label: "Last 30 days" }, sections: [{ key: "created", label: "Raised by you", total: 1, byStatus: [{ status: "OPEN", label: "Open", count: 1 }], byPriority: [] }] } } }));
    const card = screen.getByRole("region", { name: "Your Ticket Summary" });
    const style = getComputedStyle(card);
    expect(style.maxWidth).toBe("100%");
    expect(style.overflowWrap).toBe("anywhere");
    // Grid columns never ask for more than the available width.
    const grid = within(card).getByRole("list", { name: "Raised by you by status" });
    expect(getComputedStyle(grid).gridTemplateColumns).toContain("min(96px, 100%)");
  });
});
