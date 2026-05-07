export function isScannedPDF(text: string): boolean {
  return text.trim().length < 50;
}
