import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ids = [
  "tdQCMuaJUQk",
  "JFDm4p8T6_4",
  "wXD33Jx25oI",
  "FSqTqdjf2YQ",
  "iXTuYbyH2Rc",
  "-J7Oi1-EfG8",
  "_H6zuJAtQqI",
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iketeru-ytdlp-test-"));
const results = [];

for (const id of ids) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const outTmpl = path.join(tmpDir, `${id}.%(ext)s`);
  const rec = {
    id,
    url,
    tested_at: new Date().toISOString(),
    command: `yt-dlp -f "worst[ext=mp4]/worst" --download-sections "*0:00-0:02" --no-warnings -o <tmp> ${url}`,
    ok: false,
    downloaded_bytes: 0,
    ext: null,
    error: null,
  };
  try {
    execFileSync(
      "yt-dlp",
      ["-f", "worst[ext=mp4]/worst", "--download-sections", "*0:00-0:02", "--no-warnings", "-o", outTmpl, url],
      { stdio: "pipe", timeout: 45000 }
    );
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`${id}.`));
    if (files.length > 0) {
      const fp = path.join(tmpDir, files[0]);
      const st = fs.statSync(fp);
      rec.ok = st.size > 0;
      rec.downloaded_bytes = st.size;
      rec.ext = path.extname(files[0]).replace(/^\./, "");
      fs.unlinkSync(fp);
    } else {
      rec.error = "No output file created";
    }
  } catch (e) {
    rec.error = (e.stderr ? e.stderr.toString("utf8") : e.message).slice(0, 300);
  }
  results.push(rec);
  console.log(`${id} | ok=${rec.ok} | bytes=${rec.downloaded_bytes} | ext=${rec.ext} | err=${rec.error || ""}`);
}

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.writeFileSync(
  "E:/iketeru-eizou/analysis/restricted_ytdlp_check.json",
  JSON.stringify({ checked_count: results.length, ok_count: results.filter(r => r.ok).length, results }, null, 2) + "\n",
  "utf8"
);
