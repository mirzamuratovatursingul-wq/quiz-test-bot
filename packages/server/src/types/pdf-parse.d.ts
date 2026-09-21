declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: { max?: number; pagerender?: (pageData: unknown) => Promise<string> },
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
