/** Anonymous checks: no credentials, session cookies, registrations or business writes. */
export async function probeMemberSite(origin, { timeoutMs = 2000, fetchImpl = fetch } = {}) {
  const url = new URL(origin);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid member site origin");
  }
  const result = { origin: url.origin, pageReady: false, sessionReady: false, originReady: false, ready: false };
  try {
    const page = await fetchImpl(url.origin + "/", { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    result.pageReady = page.status === 200 && !!page.headers.get("content-type")?.includes("text/html");
    await page.body?.cancel();
    if (!result.pageReady) return { ...result, code: "PAGE_UNAVAILABLE" };
    const session = await fetchImpl(url.origin + "/api/session", { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const sessionBody = await session.json().catch(() => null);
    result.sessionReady = session.status === 200 && !!sessionBody && Object.hasOwn(sessionBody, "user");
    if (!result.sessionReady) return { ...result, code: "SESSION_UNAVAILABLE" };
    // POST /api/session has no mutation handler. Without a cookie, passing the
    // origin gate must reach AUTH_REQUIRED; a proxy-origin failure returns 403.
    const post = await fetchImpl(url.origin + "/api/session", {
      method: "POST", redirect: "manual", headers: { origin: url.origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
      body: "{}", signal: AbortSignal.timeout(timeoutMs),
    });
    const postBody = await post.json().catch(() => null);
    result.originReady = post.status === 401 && postBody?.code === "AUTH_REQUIRED";
    return { ...result, ready: result.originReady, ...(result.originReady ? {} : { code: "ORIGIN_UNAVAILABLE" }) };
  } catch {
    return { ...result, code: "REQUEST_FAILED" };
  }
}
