// Purely numeric, globally unique ticket number, e.g. seq=27001 -> "2627001"
// — derived from Ticket.seq, a Postgres-native autoincrement column that is
// inherently collision-safe (no manual locking/increment required). The
// offset (2600000) is cosmetic only — it just keeps ticket numbers at a
// consistent 7-digit magnitude from the start rather than beginning at "1".
const TICKET_NUMBER_OFFSET = 2600000;

function buildTicketNumber(seq) {
  return String(TICKET_NUMBER_OFFSET + seq);
}

module.exports = { buildTicketNumber, TICKET_NUMBER_OFFSET };
