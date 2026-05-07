export function chunkText(
  text: string,
  chunkSize = 4000, // ลดขนาดลงเล็กน้อยเพื่อความแม่นยำ
  overlap = 400,
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // ถ้ายังไม่จบข้อความ และจุดที่ตัดไม่ใช่จุดจบประโยค ให้พยายามขยับไปหาจุดตัดที่สวยงาม
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      const lastFullStop = text.lastIndexOf(". ", end);
      
      // หาจุดตัดที่ดีที่สุด (Newline หรือ Full stop) ภายในระยะ 500 ตัวอักษรย้อนหลังจากจุดตัดเดิม
      const bestCut = Math.max(lastNewline, lastFullStop);
      if (bestCut > start + (chunkSize * 0.8)) {
        end = bestCut + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    
    // ป้องกัน Infinite loop ถ้า overlap ใหญ่เกินไป
    if (start >= end) start = end;
  }

  return chunks.filter(c => c.length > 50); // กรอง chunk ที่สั้นเกินไปออก
}

