// Shared expansion utilities used by both the CLI and the Cloudflare Worker

export async function expandToNavigateUrl(inputUrl) {
  const resolved = await fetchFollow(inputUrl);
  const navUrl = buildDirUrl(resolved);
  return { resolved, navUrl };
}

export async function fetchFollow(startUrl, maxHops = 10, timeoutMs = 10000) {
  let current = startUrl;
  for (let i = 0; i < maxHops; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Mobile Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(t);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }

    if (res.status === 200) {
      const text = await res.text();
      const meta = text.match(/<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"'>\s]+)["']/i);
      if (meta && meta[1]) {
        const next = decodeHtmlEntities(meta[1]);
        current = new URL(next, current).toString();
        continue;
      }
      const linkParam = text.match(/[?&]link=([^&"'<>]+)/i);
      if (linkParam && linkParam[1]) {
        current = decodeURIComponent(linkParam[1]);
        continue;
      }
      const direct = text.match(/https?:\/\/(?:www\.)?google\.[^\/"' ]+\/maps[^"' <]+/i);
      if (direct && direct[0]) {
        current = direct[0];
      }
    }
    break;
  }
  return current;
}

export function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function extractDestination(finalUrl) {
  const result = { lat: null, lng: null, placeId: null, address: null };
  try {
    const u = new URL(finalUrl);

    const destPid = u.searchParams.get("destination_place_id") || u.searchParams.get("query_place_id");
    if (destPid) result.placeId = destPid;

    const dest = u.searchParams.get("destination");
    if (dest) {
      const m = dest.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (m) {
        result.lat = m[1];
        result.lng = m[2];
      } else {
        result.address = dest;
      }
    }

    const q = u.searchParams.get("q");
    if (q) {
      const pidMatch = q.match(/^\s*place_id:\s*([^,\s]+)/i);
      if (pidMatch) result.placeId = result.placeId || pidMatch[1];
      const locMatch = q.match(/^\s*loc:\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
      const llMatch = q.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (locMatch) {
        result.lat = result.lat || locMatch[1];
        result.lng = result.lng || locMatch[2];
      } else if (llMatch) {
        result.lat = result.lat || llMatch[1];
        result.lng = result.lng || llMatch[2];
      } else if (!/^\s*place_id:/i.test(q)) {
        result.address = result.address || q;
      }
    }

    if (!result.lat || !result.lng) {
      const at = finalUrl.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+),/);
      if (at) {
        result.lat = result.lat || at[1];
        result.lng = result.lng || at[2];
      }
    }
    if (!result.lat || !result.lng) {
      const bang = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (bang) {
        result.lat = result.lat || bang[1];
        result.lng = result.lng || bang[2];
      }
    }
    if (!result.lat || !result.lng) {
      const ll = u.searchParams.get("ll") || u.searchParams.get("sll");
      if (ll) {
        const m2 = ll.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
        if (m2) {
          result.lat = result.lat || m2[1];
          result.lng = result.lng || m2[2];
        }
      }
    }

    const placePath = u.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (placePath && placePath[1] && !result.address) {
      const name = decodeURIComponent(placePath[1]).replace(/\+/g, " ");
      if (name && name.length > 1) result.address = name;
    }
    const searchPath = u.pathname.match(/\/maps\/search\/([^/]+)/i);
    if (searchPath && searchPath[1] && !result.address) {
      const name = decodeURIComponent(searchPath[1]).replace(/\+/g, " ");
      if (name && name.length > 1) result.address = name;
    }
  } catch {}
  return result;
}

export function buildDirUrl(finalUrl) {
  const dest = extractDestination(finalUrl);
  if (!dest.lat || !dest.lng) return null;
  const base = new URL("https://www.google.com/maps/dir/");
  base.searchParams.set("api", "1");
  base.searchParams.set("travelmode", "driving");
  base.searchParams.set("dir_action", "navigate");
  base.searchParams.set("destination", `${dest.lat},${dest.lng}`);
  if (dest.placeId) base.searchParams.set("destination_place_id", dest.placeId);
  if (dest.address) base.searchParams.set("destination_label", dest.address);
  return base.toString();
}
