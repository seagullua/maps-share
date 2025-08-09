#!/usr/bin/env node
/**
 * Expand Google Maps share URLs (maps.app.goo.gl -> full maps URL)
 * and output a single URL string to be used as Intent data that
 * starts Google Maps driving navigation immediately. Uses place_id
 * when available to preserve the place.
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

function extractDestinationFromResolved(finalUrl) {
  // Parse destination from a Google Maps URL. Prefer coordinates when available.
  try {
    const u = new URL(finalUrl);
    // Prefer explicit place_id if present
    const destPid = u.searchParams.get("destination_place_id") || u.searchParams.get("query_place_id");
    if (destPid) return { placeId: destPid };
    // 1) Explicit destination= in dir URLs
    const dest = u.searchParams.get("destination");
    if (dest) {
      const m = dest.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (m) return { lat: m[1], lng: m[2] };
      return { address: dest };
    }

    // 2) q= in place/search URLs
    const q = u.searchParams.get("q");
    if (q) {
      const pidMatch = q.match(/^\s*place_id:\s*([^,\s]+)/i);
      if (pidMatch) return { placeId: pidMatch[1] };
      const locMatch = q.match(/^\s*loc:\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
      const llMatch = q.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (locMatch) return { lat: locMatch[1], lng: locMatch[2] };
      if (llMatch) return { lat: llMatch[1], lng: llMatch[2] };
      // If q is a free-text address, use it as address
      if (!/^\s*place_id:/i.test(q)) return { address: q };
    }

    // 3) @lat,lng,zoom in path
    const at = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/);
    if (at) return { lat: at[1], lng: at[2] };

    // 4) !3dLAT!4dLNG pattern in path
    const bang = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (bang) return { lat: bang[1], lng: bang[2] };

    // 5) ll= or sll=
    const ll = u.searchParams.get("ll") || u.searchParams.get("sll");
    if (ll) {
      const m = ll.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (m) return { lat: m[1], lng: m[2] };
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function detectUrlContext(finalUrl) {
  try {
    const u = new URL(finalUrl);
    const path = u.pathname || "";
    const search = u.search || "";

    const isDirections = /\/(dir|directions)\b/i.test(path) ||
      u.searchParams.has("dir_action") ||
      u.searchParams.has("destination") ||
      u.searchParams.has("destination_place_id");

    const hasPlaceSignals = /\/place\//i.test(path) ||
      u.searchParams.has("query_place_id") ||
      /\bq=place_id:/i.test(search) ||
      u.searchParams.has("ftid");

    // If q= exists and isn't pure coords, consider it a place/address search
    const q = u.searchParams.get("q");
    if (q && !/^\s*(loc:)?-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*$/i.test(q)) {
      return { isDirections, isPlace: true };
    }

    return { isDirections, isPlace: hasPlaceSignals };
  } catch {
    return { isDirections: false, isPlace: false };
  }
}

function buildAndroidPinIntentFromResolved(finalUrl) {
  const dest = extractDestinationFromResolved(finalUrl);
  // Prefer coordinates; fall back to address
  if (dest.lat && dest.lng) return `geo:0,0?q=${dest.lat},${dest.lng}`;
  if (dest.address) return `geo:0,0?q=${encodeURIComponent(dest.address)}`;
  // Also try place_id if present in q=
  try {
    const u = new URL(finalUrl);
    const q = u.searchParams.get("q");
    const pid = q && q.match(/^\s*place_id:\s*([^,\s]+)/i);
    if (pid) return `geo:0,0?q=place_id:${pid[1]}`;
  } catch {}
  return null;
}

function buildGoogleNavigationUrl(finalUrl) {
  const dest = extractDestinationFromResolved(finalUrl);
  if (dest.placeId) return `google.navigation:q=place_id:${dest.placeId}&mode=d`;
  if (dest.lat && dest.lng) return `google.navigation:q=${dest.lat},${dest.lng}&mode=d`;
  if (dest.address) return `google.navigation:q=${encodeURIComponent(dest.address)}&mode=d`;
  return null;
}

async function processOne(input) {
  const resolved = await fetchFollow(input);
  const navUrl = buildGoogleNavigationUrl(resolved);
  return {
    input,
    resolvedUrl: resolved,
    navUrl,
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
      // Print only one URL: Google Maps directions URL that starts navigation; fallback to resolved URL
      console.log(out.navUrl || out.resolvedUrl);
    } catch (e) {
      console.error(`Error processing ${u}:`, e.message || e);
    }
  }
})();
