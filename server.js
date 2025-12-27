const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function send(res, code, body, headers) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", ...(headers || {}) });
  res.end(body);
}

function safeResolve(root, urlPath) {
  const clean = decodeURIComponent(urlPath).replace(/\0/g, "");
  const normalized = path.posix.normalize(clean);
  const withoutLeading = normalized.replace(/^(\.\.(\/|\\|$))+/, "");
  const fsPath = path.resolve(root, "." + withoutLeading);
  if (!fsPath.startsWith(root)) return null;
  return fsPath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname || "/";

  if (pathname === "/") {
    const html = `<!doctype html>
<meta charset="utf-8" />
<title>Workout Connect</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; padding:24px; line-height:1.5}
  code{background:#f2f2f2; padding:2px 6px; border-radius:6px}
</style>
<h1>Workout Connect (local)</h1>
<p>Open: <a href="/web/body-battery-test.html"><code>/web/body-battery-test.html</code></a></p>
`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const filePath = safeResolve(ROOT, pathname);
  if (!filePath) return send(res, 400, "Bad path");

  fs.stat(filePath, (err, st) => {
    if (err) return send(res, 404, "Not found");

    if (st.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      fs.stat(indexPath, (err2, st2) => {
        if (err2 || !st2.isFile()) return send(res, 404, "Not found");
        const ext = path.extname(indexPath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(indexPath).pipe(res);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`Server running: http://127.0.0.1:${PORT}/web/body-battery-test.html`);
});

