// Constants at top (hardcoded configuration)
export const SECRET_API_KEY = "djkdf3498";
const PUSHOVER_TOKEN = "aw7uo6ao9ghayk565s1hzdnnp9iis7";
const PUSHOVER_USER = "utjhv2xo4542mumsbsu8pe6zoa7bz7";
const DEFAULT_TITLE = "TEST";
const DEFAULT_PRIORITY = "0";
const DEFAULT_SOUND = "";
const DEFAULT_DEVICE = "HyundaiSantaFe";

import { expandToNavigateUrl } from "./shared.js";

export async function expandAndPush(shareUrl, options = {}) {
  const { title, priority, sound, device } = options;
  const { resolved, navUrl } = await expandToNavigateUrl(shareUrl);
  if (!navUrl) {
    return { ok: false, error: "Could not build navigation URL", resolvedUrl: resolved };
  }

  const pushRes = await pushPushover({
    message: "TEST_NAVIGATION",
    url: navUrl,
    title: title || DEFAULT_TITLE,
    priority: (priority ?? DEFAULT_PRIORITY).toString(),
    sound: sound ?? DEFAULT_SOUND,
    device: device ?? DEFAULT_DEVICE,
  });

  return { ok: true, resolvedUrl: resolved, navigateUrl: navUrl, pushover: pushRes };
}

async function pushPushover({ message, url, title, priority, sound, device }) {
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) return { ok: false, error: "Missing Pushover credentials" };
  const form = new URLSearchParams();
  form.set("token", PUSHOVER_TOKEN);
  form.set("user", PUSHOVER_USER);
  form.set("message", message);
  if (url) form.set("url", url);
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


