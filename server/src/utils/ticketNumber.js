// Formats a department-specific sequence number into the OLD department-wise
// ticket ID, e.g. prefix="HW", sequence=1 -> "HW-0001". No longer used to
// generate Ticket.ticketNumber (see buildTicketNumber below) — kept only in
// case any historical/reporting code still wants this display format from
// Department.ticketPrefix/ticketSequence.
function formatDepartmentTicketNumber(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

// Purely numeric, globally unique ticket number, e.g. seq=27001 -> "2627001"
// — derived from Ticket.seq, a Postgres-native autoincrement column that is
// inherently collision-safe (no manual locking/increment required). The
// offset (2600000) is cosmetic only — it just keeps ticket numbers at a
// consistent 7-digit magnitude from the start rather than beginning at "1".
const TICKET_NUMBER_OFFSET = 2600000;

function buildTicketNumber(seq) {
  return String(TICKET_NUMBER_OFFSET + seq);
}

module.exports = { formatDepartmentTicketNumber, buildTicketNumber, TICKET_NUMBER_OFFSET };
