declare module "pdf-parse" {
  interface PdfData {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfData>;
  export default pdfParse;
}

declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse = require("pdf-parse");
  export default pdfParse;
}