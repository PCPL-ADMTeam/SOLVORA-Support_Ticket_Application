// Prints the report written by the last `npm run test:chatbot` run (reports/chatbot-regression-report.txt).
const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "../reports/chatbot-regression-report.txt");
if (!fs.existsSync(file)) {
  console.error("No report yet. Run `npm run test:chatbot` first.");
  process.exit(1);
}
process.stdout.write(fs.readFileSync(file, "utf8"));
console.log(`JSON: ${path.resolve(__dirname, "../reports/chatbot-regression-report.json")}`);
console.log(`CSV:  ${path.resolve(__dirname, "../reports/chatbot-regression-results.csv")}`);
