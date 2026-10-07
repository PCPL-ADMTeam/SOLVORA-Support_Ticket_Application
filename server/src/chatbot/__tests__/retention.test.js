jest.mock("../../config/prisma", () => ({
  chatConversation: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
  chatAuditEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 7 }) },
  chatTicketDraft: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
}));

const prisma = require("../../config/prisma");
const { purgeOldChatData } = require("../retention");

test("deletes conversations and audit events older than the cutoff", async () => {
  const result = await purgeOldChatData(90);
  expect(result).toMatchObject({ conversationsDeleted: 3, auditEventsDeleted: 7 });
  const cutoff = prisma.chatConversation.deleteMany.mock.calls[0][0].where.lastMessageAt.lt;
  expect(Date.now() - cutoff.getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
  expect(prisma.chatAuditEvent.deleteMany.mock.calls[0][0].where.createdAt.lt).toEqual(cutoff);
  // abandoned ticket drafts (and their stored files) are removed the same way
  expect(prisma.chatTicketDraft.deleteMany.mock.calls[0][0].where.updatedAt.lt).toEqual(cutoff);
});

test.each([0, -1, 1.5, "90", undefined])("rejects invalid retention %p", async (days) => {
  await expect(purgeOldChatData(days)).rejects.toThrow("positive integer");
});
