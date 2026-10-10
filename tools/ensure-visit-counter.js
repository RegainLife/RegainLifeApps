// コミットしようとしている HTML ページに、アクセスカウンタの読み込み（assets/visit-counter.js）が
// 無ければ </body> の直前に足して、ステージし直す。新しいアプリのページを足したときの入れ忘れ防止。
// .git/hooks/pre-commit から呼ぶ。失敗してもコミットは止めない。
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=AM"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !f.startsWith(".claude") && !/^google[0-9a-f]+\.html$/.test(path.basename(f)));

for (const rel of staged) {
  const file = path.join(root, rel);
  let s = fs.readFileSync(file, "utf8");
  if (s.includes("visit-counter.js")) continue;
  const i = s.lastIndexOf("</body>");
  if (i < 0) continue;
  const depth = rel.split("/").length - 1;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  const eol = s.includes("\r\n") ? "\r\n" : "\n";
  s = s.slice(0, i) + `  <script type="module" src="${prefix}assets/visit-counter.js"></script>${eol}` + s.slice(i);
  fs.writeFileSync(file, s, "utf8");
  execFileSync("git", ["add", "--", rel], { cwd: root });
  console.log(`アクセスカウンタの読み込みを足しました: ${rel}`);
}
