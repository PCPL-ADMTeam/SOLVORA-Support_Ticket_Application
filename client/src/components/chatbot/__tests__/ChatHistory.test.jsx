import { describe, expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../api/chatbot", () => ({
  chatbotApi: {
    suggestions: vi.fn(),
    sendMessage: vi.fn(),
    resetConversation: vi.fn(),
    sendFeedback: vi.fn(),
    listConversations: vi.fn(),
    resumeConversation: vi.fn(),
    getConversation: vi.fn(),
    deleteConversation: vi.fn(),
    deleteConversations: vi.fn(),
    deleteAllConversations: vi.fn(),
  },
}));

import { chatbotApi } from "../../../api/chatbot";
import ChatWidget from "../ChatWidget";

// Conversation history management: select one / several / a whole page, delete selected, delete all,
// cancel, the open conversation, failures, paging. The server is the authority on whose conversations
// these are; the browser only ever sends conversation ids (never a user id).

const INTRO = { portal: "Employee Portal", role: "EMPLOYEE", welcomeMessage: "Hi!", suggestions: [], welcomeSubtitle: "How can I help you with your tickets today?", quickActions: [], capabilities: [] };
const now = new Date().toISOString();
const convo = (id, title) => ({ conversationId: id, title, status: "ACTIVE", lastMessageAt: now });
const page = (conversations, extra = {}) => ({ data: { data: { conversations, total: conversations.length, page: 1, pageSize: 10, totalPages: 1, ...extra } } });
const A = convo("conv-a", "Show my open tickets");
const B = convo("conv-b", "How do I change my password?");
const C = convo("conv-c", "What's new today");
const apiError = (code, message, status = 500) => ({ response: { status, data: { success: false, error: { code, message } } } });

function setup() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/portal"]}>
      <ChatWidget />
    </MemoryRouter>
  );
  return { user };
}

const openHistory = async (user) => {
  await user.click(screen.getByRole("button", { name: "Open assistant chat" }));
  await user.click(await screen.findByRole("button", { name: "Chat history" }));
  return screen.findByRole("region", { name: "Chat history" });
};
const startSelecting = async (user) => user.click(await screen.findByRole("button", { name: "Select" }));

beforeEach(() => {
  vi.clearAllMocks();
  chatbotApi.suggestions.mockResolvedValue({ data: { data: INTRO } });
  chatbotApi.resetConversation.mockResolvedValue({});
});

describe("selecting conversations", () => {
  test("Select shows a checkbox per conversation; picking one, then several, updates the count", async () => {
    chatbotApi.listConversations.mockResolvedValue(page([A, B, C]));
    const { user } = setup();
    await openHistory(user);
    // Before "Select" there are no checkboxes, so a click on a card only ever opens it.
    expect(screen.queryByRole("checkbox", { name: /Select conversation/ })).not.toBeInTheDocument();

    await startSelecting(user);
    const toolbar = screen.getByRole("toolbar", { name: "Selection" });
    expect(within(toolbar).getByRole("button", { name: "Delete selected" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Select conversation: Show my open tickets" }));
    expect(within(toolbar).getByText("1 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select conversation: What's new today" }));
    expect(within(toolbar).getByText("2 selected")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Delete selected" })).toBeEnabled();
    // Clicking the card text toggles the selection; it never opens the conversation.
    await user.click(screen.getByText("Show my open tickets"));
    expect(within(toolbar).getByText("1 selected")).toBeInTheDocument();
    expect(chatbotApi.resumeConversation).not.toHaveBeenCalled();
  });

  test("'Select all on this page' selects every conversation on the page, and toggles back", async () => {
    chatbotApi.listConversations.mockResolvedValue(page([A, B], { total: 12, totalPages: 2 }));
    const { user } = setup();
    await openHistory(user);
    await startSelecting(user);
    const all = screen.getByRole("checkbox", { name: "Select all on this page" });
    await user.click(all);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select conversation: Show my open tickets" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select conversation: How do I change my password?" })).toBeChecked();
    await user.click(all);
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  });
});

describe("deleting", () => {
  test("delete selected asks first and sends only the chosen ids; the selection clears afterwards", async () => {
    chatbotApi.listConversations.mockResolvedValueOnce(page([A, B, C])).mockResolvedValue(page([B]));
    chatbotApi.deleteConversations.mockResolvedValue({ data: { data: { deleted: 2, deletedIds: ["conv-a", "conv-c"] } } });
    const { user } = setup();
    await openHistory(user);
    await startSelecting(user);
    await user.click(screen.getByRole("checkbox", { name: "Select conversation: Show my open tickets" }));
    await user.click(screen.getByRole("checkbox", { name: "Select conversation: What's new today" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));

    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete 2 selected conversations permanently? This can't be undone.");
    expect(chatbotApi.deleteConversations).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete 2 conversations" }));

    await waitFor(() => expect(chatbotApi.deleteConversations).toHaveBeenCalledWith(["conv-a", "conv-c"]));
    expect(await screen.findByRole("status", { name: "History update" })).toHaveTextContent("Deleted 2 conversations.");
    await waitFor(() => expect(screen.queryByText("Show my open tickets")).not.toBeInTheDocument());
    expect(screen.getByText("How do I change my password?")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ selected$/)).not.toBeInTheDocument();
    // The page was read again so the counts stay right.
    expect(chatbotApi.listConversations).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 });
  });

  test("cancelling a confirmation deletes nothing (single and selected)", async () => {
    chatbotApi.listConversations.mockResolvedValue(page([A, B]));
    const { user } = setup();
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "Delete conversation: Show my open tickets" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));
    await startSelecting(user);
    await user.click(screen.getByRole("checkbox", { name: "Select conversation: Show my open tickets" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(chatbotApi.deleteConversation).not.toHaveBeenCalled();
    expect(chatbotApi.deleteConversations).not.toHaveBeenCalled();
    // The selection survives a cancel.
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  test("the confirmation starts on its safe choice", async () => {
    chatbotApi.listConversations.mockResolvedValue(page([A]));
    const { user } = setup();
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "Delete conversation: Show my open tickets" }));
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus();
  });

  test("delete all explains exactly what goes (and what does not), then deletes everything", async () => {
    chatbotApi.listConversations.mockResolvedValueOnce(page([A, B], { total: 14, totalPages: 2 })).mockResolvedValue(page([]));
    chatbotApi.deleteAllConversations.mockResolvedValue({ data: { data: { deleted: 14 } } });
    const { user } = setup();
    await openHistory(user);
    await startSelecting(user);
    await user.click(screen.getByRole("button", { name: "Delete all" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete all of your conversations (14)?");
    expect(confirm).toHaveTextContent("Your tickets, comments and notifications are not affected.");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(chatbotApi.deleteAllConversations).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete all" }));
    await user.click(screen.getByRole("button", { name: "Delete all conversations" }));
    await waitFor(() => expect(chatbotApi.deleteAllConversations).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status", { name: "History update" })).toHaveTextContent("Deleted 14 conversations.");
    expect(await screen.findByText(/No earlier conversations yet/)).toBeInTheDocument();
  });

  test("deleting the conversation that is open starts a new chat safely", async () => {
    chatbotApi.listConversations.mockResolvedValueOnce(page([A, B])).mockResolvedValueOnce(page([A, B])).mockResolvedValue(page([B]));
    chatbotApi.resumeConversation.mockResolvedValue({});
    chatbotApi.getConversation.mockResolvedValue({ data: { data: { conversationId: "conv-a", messages: [
      { id: "m1", sender: "user", text: "Show my open tickets", createdAt: now },
      { id: "m2", sender: "assistant", text: "You have 2 open tickets.", data: {}, createdAt: now },
    ] } } });
    chatbotApi.deleteConversation.mockResolvedValue({});
    chatbotApi.sendMessage.mockResolvedValue({ data: { data: { conversationId: "conv-new", messageId: "x1", message: "Hello again.", data: {}, suggestedActions: [], navigationTarget: null, error: null } } });
    const { user } = setup();
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: /^Show my open tickets/ }));
    expect(await screen.findByText("You have 2 open tickets.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chat history" }));
    await user.click(await screen.findByRole("button", { name: "Delete conversation: Show my open tickets" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("status", { name: "History update" })).toHaveTextContent("The conversation you had open was deleted, so a new chat is ready.");

    await user.click(screen.getByRole("button", { name: "Chat history" }));
    expect(screen.queryByText("You have 2 open tickets.")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Message to the assistant" }), "hello{Enter}");
    // The next message starts a new conversation instead of going to the deleted one.
    await waitFor(() => expect(chatbotApi.sendMessage).toHaveBeenCalledWith("hello", null, null));
  });

  test("a failed delete says so, keeps the selection, and Retry tries again", async () => {
    chatbotApi.listConversations.mockResolvedValueOnce(page([A, B])).mockResolvedValue(page([B]));
    chatbotApi.deleteConversations.mockRejectedValueOnce(apiError("CHAT_DATABASE_ERROR", "Something went wrong on our side.")).mockResolvedValueOnce({ data: { data: { deleted: 1, deletedIds: ["conv-a"] } } });
    const { user } = setup();
    await openHistory(user);
    await startSelecting(user);
    await user.click(screen.getByRole("checkbox", { name: "Select conversation: Show my open tickets" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(screen.getByRole("button", { name: "Delete 1 conversation" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("I couldn't delete the selected conversations. Please try again.");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("status", { name: "History update" })).toHaveTextContent("Deleted 1 conversation.");
    expect(chatbotApi.deleteConversations).toHaveBeenCalledTimes(2);
  });

  test("pressing Delete twice sends one request", async () => {
    chatbotApi.listConversations.mockResolvedValue(page([A]));
    let finish;
    chatbotApi.deleteConversation.mockReturnValue(new Promise((r) => (finish = r)));
    const { user } = setup();
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "Delete conversation: Show my open tickets" }));
    const del = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(del);
    fireEvent.click(del);
    await waitFor(() => expect(del).toBeDisabled());
    expect(chatbotApi.deleteConversation).toHaveBeenCalledTimes(1);
    finish({});
    await screen.findByRole("status", { name: "History update" });
  });

  test("the history never sends a user id: only conversation ids", async () => {
    chatbotApi.listConversations.mockResolvedValue(page([A]));
    chatbotApi.deleteConversations.mockResolvedValue({ data: { data: { deleted: 1, deletedIds: ["conv-a"] } } });
    const { user } = setup();
    await openHistory(user);
    await startSelecting(user);
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(screen.getByRole("button", { name: "Delete 1 conversation" }));
    await waitFor(() => expect(chatbotApi.deleteConversations).toHaveBeenCalled());
    expect(chatbotApi.deleteConversations.mock.calls[0]).toEqual([["conv-a"]]);
  });
});

describe("paging", () => {
  test("Next and Previous load other pages; the selection belongs to one page", async () => {
    chatbotApi.listConversations.mockImplementation(async ({ page: p }) => (p === 2 ? page([C], { page: 2, total: 11, totalPages: 2 }) : page([A, B], { page: 1, total: 11, totalPages: 2 })));
    const { user } = setup();
    await openHistory(user);
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Recent conversations (11)")).toBeInTheDocument();
    await startSelecting(user);
    await user.click(screen.getByRole("checkbox", { name: "Select conversation: Show my open tickets" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("What's new today")).toBeInTheDocument();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  });

  test("a failed load shows an error with Retry", async () => {
    chatbotApi.listConversations.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(page([A]));
    const { user } = setup();
    await openHistory(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("I could not load your chat history.");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Show my open tickets")).toBeInTheDocument();
  });
});
