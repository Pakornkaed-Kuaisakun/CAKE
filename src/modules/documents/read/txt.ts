import fs from "fs";

export function readTxt(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}
