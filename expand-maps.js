#!/usr/bin/env node
/**
 * Expand Google Maps share URLs (maps.app.goo.gl -> full maps URL) and
 * optionally add the parameter that starts navigation on open.
 *
 * Requires: Node.js 18+ (uses global fetch)
 */

const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchFollow(url, maxHops = 10, timeoutMs = 10000) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(t);
    }

    // Handle HTTP redirects first
    if (REDIRECT_CODES.has(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }

    // If 200, see if the HTML includes a meta-refresh or direct maps URL
    if (res.status === 200) {
      const text = await res.text();

      // meta refresh: <meta http-equiv="refresh" content="0;url=...">
      const meta = text.match(
        /<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)["']/i
      );
      if (meta && meta[1]) {
        const next = decodeHtmlEntities(meta[1]);
        current = new URL(next, current).toString();
        continue;
      }

      // Sometimes there's a ?link=<encoded maps url>
      const linkParam = text.match(/[?&]link=([^&"'<>]+)/i);
      if (linkParam && linkParam[1]) {
        current = decodeURIComponent(linkParam[1]);
        continue;
      }

      // Fallback: sniff a google maps URL in the HTML
      const direct = text.match(
        /https?:\/\/(?:www\.)?google\.[^\/"' ]+\/maps[^"' <]+/i
      );
      if (direct && direct[0]) {
        current = direct[0];
      }
    }

    // Either non-redirect 2xx (with nothing else to follow) or something else.
    break;
  }
  return current;
}

function addNavigateParam(finalUrl) {
  // Add the parameter that triggers navigation when opening the URL in Maps
  try {
    const u = new URL(finalUrl);
    // Only touch Google Maps URLs
    const isGoogleMaps = /(^|\.)google\./i.test(u.hostname) && /\/maps\b/i.test(u.pathname);
    if (!isGoogleMaps) return null;
    u.searchParams.set("dir_action", "navigate");
    return u.toString();
  } catch {
    return null;
  }
}

async function processOne(input) {
  const resolved = await fetchFollow(input);
  const resolvedNavigate = addNavigateParam(resolved);

  return {
    input,
    resolvedUrl: resolved,
    resolvedUrlNavigate: resolvedNavigate || null,
  };
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

(async () => {
  const args = process.argv.slice(2).filter(Boolean);
  let urls = [...args];

  if (urls.length === 0) {
    const stdin = await readStdin();
    if (stdin.trim()) {
      urls = stdin
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  if (urls.length === 0) {
    console.error(
      "Usage: node expand-maps.js <maps.app.goo.gl URL> [more ...]\n" +
        "   or: cat urls.txt | node expand-maps.js"
    );
    process.exit(1);
  }

  for (const u of urls) {
    try {
      const out = await processOne(u);
      console.log("Input:         ", out.input);
      console.log("Resolved URL:  ", out.resolvedUrl);
      console.log(
        "Resolved URL (navigate):",
        out.resolvedUrlNavigate || "(navigation param not applicable)"
      );
      console.log("-".repeat(60));
    } catch (e) {
      console.error(`Error processing ${u}:`, e.message || e);
    }
  }
})();
