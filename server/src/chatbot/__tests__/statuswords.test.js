jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// "onhold", "on_hold", "inprogress" must filter by status exactly like "on hold" / "in progress".
const service = require("../chatbot.service");
const { users, seedDefault } = require("../testkit/fixtures");

beforeEach(() => seedDefault());
const nums = (r) => (r.data?.tickets || []).map((t) => t.ticketNumber).sort();
const ask = (text, cid) => service.sendMessage(users.admin, { message: text, conversationId: cid });

describe("status words written without spaces", () => {
  test.each(["show on hold tickets", "show onhold tickets", "show on_hold tickets", "show on-hold tickets"])("%s lists only On Hold tickets", async (q) => {
    const r = await ask(q);
    expect(nums(r)).toEqual(["2627002"]);
  });

  test("'how many onhold tickets' counts only On Hold, and 'Show them' lists the same ones", async () => {
    const r = await ask("how many onhold tickets");
    expect(r.message).toMatch(/1 on hold ticket/);
    const again = await ask("Show them", r.conversationId);
    expect(nums(again)).toEqual(["2627002"]);
  });

  test("'inprogress' filters In Progress", async () => {
    const r = await ask("show inprogress tickets");
    expect(nums(r)).toEqual(["2627001", "2627003"]);
  });
});
