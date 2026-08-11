import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/app.db");
const rows = db.prepare(`SELECT * FROM statement_docs WHERE ins_code = ? LIMIT 5`).all("37614886280396031");
console.log(JSON.stringify(rows, null, 1).slice(0, 2500));
