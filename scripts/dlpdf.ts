import fs from "fs";
import { downloadPdf } from "../lib/market/codal";
async function main() {
  const url = "https://www.codal.ir/DownloadFile.aspx?hs=X9aq3lTDFn3jjDkSglU5QQQaQQQA%3d%3d&ft=1005&let=6";
  const buf = await downloadPdf(url);
  fs.writeFileSync("/tmp/statement.pdf", Buffer.from(buf));
  console.log("saved", buf.byteLength);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
