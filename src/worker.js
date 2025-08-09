import { expandToNavigateUrl } from "./shared.js";
// Constants (hardcoded config per request)
const DEFAULT_TITLE = "Maps Navigation"; // PUSHOVER_TITLE
const DEFAULT_PRIORITY = "0"; // PUSHOVER_PRIORITY
const DEFAULT_SOUND = ""; // PUSHOVER_SOUND
const DEFAULT_DEVICE = ""; // PUSHOVER_DEVICE

// Hard-coded config (no env usage as requested)
const SECRET_API_KEY = "CHANGE_ME_API_KEY";
const PUSHOVER_TOKEN = "CHANGE_ME_PUSHOVER_TOKEN";
const PUSHOVER_USER = "CHANGE_ME_PUSHOVER_USER";

// Accepts POST { apiKey, url } and pushes a Pushover notification with a
// Google Maps navigate URL. GET supports local testing without push.
export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
      }
      const { apiKey, url: shareUrl, device, sound, title, priority } = body || {};
      if (!apiKey || apiKey !== SECRET_API_KEY) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      if (!shareUrl) {
        return json({ ok: false, error: "Missing url" }, 400);
      }

      const { resolved, navUrl } = await expandToNavigateUrl(shareUrl);
      if (!navUrl) {
        return json({ ok: false, error: "Could not build navigation URL", resolvedUrl: resolved }, 422);
      }

      const pushRes = await pushPushover({
        message: navUrl,
        title: title || DEFAULT_TITLE,
        priority: (priority ?? DEFAULT_PRIORITY).toString(),
        sound: sound ?? DEFAULT_SOUND,
        device: device ?? DEFAULT_DEVICE,
      });

      return json({ ok: true, resolvedUrl: resolved, navigateUrl: navUrl, pushover: pushRes });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  },
};


async function pushPushover({ message, title, priority, sound, device }) {
  const token = PUSHOVER_TOKEN;
  const user = PUSHOVER_USER;
  if (!token || !user) return { ok: false, error: "Missing Pushover credentials" };
  const form = new URLSearchParams();
  form.set("token", token);
  form.set("user", user);
  form.set("message", message);
  if (title) form.set("title", title);
  if (priority) form.set("priority", priority);
  if (sound) form.set("sound", sound);
  if (device) form.set("device", device);

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
