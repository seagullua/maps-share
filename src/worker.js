import { expandAndPush, SECRET_API_KEY } from "./service.js";

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

      const result = await expandAndPush(shareUrl, { title, priority, sound, device });
      if (!result.ok) {
        return json(result, 422);
      }
      return json(result);
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
