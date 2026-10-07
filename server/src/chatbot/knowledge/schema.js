// Knowledge-base entry shape + helper. Every route/label in the KB was read
// from client/src/App.jsx and the portal layouts — if a page moves there,
// update the entry here (the knowledge-base test checks paths against a
// known-routes list).
//
// route:  { type: "route", path, label }    -> client navigates with react-router
//         { type: "dialog", dialog, label } -> client opens an existing dialog in AppShell
//         null                              -> no navigation target
const LAST_REVIEWED = "2026-10-06";

function article(def) {
  return Object.freeze({
    permissions: [],
    route: null,
    warning: null,
    keywords: [],
    lastReviewed: LAST_REVIEWED,
    active: true,
    ...def,
    steps: Object.freeze([...def.steps]),
  });
}

const route = (path, label) => ({ type: "route", path, label });
const dialog = (dialogName, label) => ({ type: "dialog", dialog: dialogName, label });

module.exports = { article, route, dialog, LAST_REVIEWED };
