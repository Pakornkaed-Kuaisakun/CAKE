import fs from "fs";
import path from "path";

const QUARANTINE_DIR = path.join(process.cwd(), ".quarantine");

export function quarantineFile(filePath: string): string {
  if (!fs.existsSync(QUARANTINE_DIR)) {
    fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  }

  const fileName = path.basename(filePath);
  const targetPath = path.join(QUARANTINE_DIR, fileName);

  fs.renameSync(filePath, targetPath);
  return targetPath;
}
