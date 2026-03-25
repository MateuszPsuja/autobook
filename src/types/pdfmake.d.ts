declare module 'pdfmake/build/pdfmake' {
  interface TDocumentDefinitions {
    content: any[];
    styles?: any;
  }

  interface PdfMakeAPI {
    createPdf(docDefinition: TDocumentDefinitions): PdfDocument;
  }

  interface PdfDocument {
    getBlob(callback: (blob: Blob) => void): void;
    open(): void;
    download(filename?: string): void;
    getBase64(callback: (base64: string) => void): void;
  }

  const pdfMake: PdfMakeAPI & { vfs?: any };
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const pdfFonts: { pdfMake?: { vfs?: any }; vfs?: any };
  export default pdfFonts;
}
