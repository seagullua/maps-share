// Shared expansion utilities used by both the CLI and the Cloudflare Worker

export async function expandToNavigateUrl(inputUrl) {
  // Handle Apple Maps text or URLs first
  const apple = extractAppleFromText(String(inputUrl || ""));
  if (apple) {
    const navFromApple = buildDirFromParts(apple.parts);
    return {
      resolved: apple.resolved,
      navUrl: navFromApple,
      debug: { parsed: apple.parts, source: "apple" },
    };
  }

  const resolved = await fetchFollow(inputUrl);
  const navUrl = buildDirUrl(resolved);
  return {
    resolved,
    navUrl,
    debug: {
      parsed: extractDestination(resolved),
      source: "google",
    },
  };
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
      const meta = text.match(/<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)["']/i);
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
      // Try to capture full google maps URLs; allow parentheses and commas
      const direct = text.match(/https?:\/\/(?:www\.)?google\.[^\s"']+\/maps[^"' <]+/i);
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
        // decode '+' as spaces for readability
        result.address = result.address || q.replace(/\+/g, " ");
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
  const base = new URL("https://www.google.com/maps/dir/");
  base.searchParams.set("api", "1");
  base.searchParams.set("travelmode", "driving");
  base.searchParams.set("dir_action", "navigate");

  if (dest.lat && dest.lng) {
    base.searchParams.set("destination", `${dest.lat},${dest.lng}`);
  } else if (dest.address) {
    base.searchParams.set("destination", dest.address);
  } else if (dest.placeId) {
    // As last resort, use place_id as destination
    base.searchParams.set("destination", `place_id:${dest.placeId}`);
  } else {
    return null;
  }

  if (dest.placeId) base.searchParams.set("destination_place_id", dest.placeId);
  if (dest.address) base.searchParams.set("destination_label", dest.address);
  return base.toString();
}

export function buildDirFromParts(parts) {
  const base = new URL("https://www.google.com/maps/dir/");
  base.searchParams.set("api", "1");
  base.searchParams.set("travelmode", "driving");
  base.searchParams.set("dir_action", "navigate");
  if (parts.lat && parts.lng) {
    base.searchParams.set("destination", `${parts.lat},${parts.lng}`);
  } else if (parts.address) {
    base.searchParams.set("destination", parts.address);
  } else if (parts.placeId) {
    base.searchParams.set("destination", `place_id:${parts.placeId}`);
  } else {
    return null;
  }
  if (parts.placeId) base.searchParams.set("destination_place_id", parts.placeId);
  if (parts.address) base.searchParams.set("destination_label", parts.address);
  return base.toString();
}

function extractAppleFromText(text) {
  try {
    let candidateUrl = null;
    // If text is a URL, check domain
    try {
      const u = new URL(text);
      if (/^maps\.apple\.com$/i.test(u.hostname)) candidateUrl = u.toString();
    } catch {}
    if (!candidateUrl) {
      const m = String(text).match(/https?:\/\/maps\.apple\.com\/[^\s"']+/i);
      if (m && m[0]) candidateUrl = m[0];
    }
    if (!candidateUrl) return null;

    const u = new URL(candidateUrl);
    const parts = { lat: null, lng: null, placeId: null, address: null };

    // coordinate=lat,lng or ll=
    const coord = u.searchParams.get("coordinate") || u.searchParams.get("ll");
    if (coord) {
      const m = coord.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (m) {
        parts.lat = m[1];
        parts.lng = m[2];
      }
    }
    // name or q
    const name = u.searchParams.get("name") || u.searchParams.get("q");
    if (name) parts.address = decodeURIComponent(name).replace(/\+/g, " ");
    // address param
    const address = u.searchParams.get("address");
    if (!parts.address && address) parts.address = decodeURIComponent(address).replace(/\+/g, " ");

    return { resolved: candidateUrl, parts };
  } catch {
    return null;
  }
}
