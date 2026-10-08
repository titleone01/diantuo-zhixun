import test from "node:test";
import assert from "node:assert/strict";
import { probeMemberSite } from "../scripts/site-readiness.mjs";

const origin = "https://train.example.com";
const fixture = (postStatus, postCode) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/")) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    if (!options.method) return Response.json({ user: null });
    return Response.json({ code: postCode }, { status: postStatus });
  };
  return { calls, fetchImpl };
};

test("readiness rejects a reachable page whose same-origin POST is broken", async () => {
  const { fetchImpl } = fixture(403, "ORIGIN_REQUIRED");
  assert.deepEqual(await probeMemberSite(origin, { fetchImpl }), { origin, pageReady: true, sessionReady: true, originReady: false, ready: false, code: "ORIGIN_UNAVAILABLE" });
});

test("readiness checks the anonymous origin gate without credentials or business writes", async () => {
  const { calls, fetchImpl } = fixture(401, "AUTH_REQUIRED");
  assert.equal((await probeMemberSite(origin, { fetchImpl })).ready, true);
  assert.equal(calls.length, 3);
  const post = calls[2];
  assert.equal(post.url, origin + "/api/session");
  assert.equal(post.options.headers.origin, origin);
  assert.equal(post.options.headers["sec-fetch-site"], "same-origin");
  assert.equal(post.options.headers.cookie, undefined);
  assert.equal(post.options.body, "{}");
  for (const [status, code] of [[200, "AUTH_REQUIRED"], [401, "OTHER"], [500, "AUTH_REQUIRED"]]) {
    assert.equal((await probeMemberSite(origin, fixture(status, code))).ready, false);
  }
});

test("readiness rejects missing session contracts, network failures and unsafe URLs", async () => {
  const fetchImpl = async url => url.endsWith("/") ? new Response("<html></html>", { headers: { "content-type": "text/html" } }) : Response.json({});
  assert.equal((await probeMemberSite(origin, { fetchImpl })).code, "SESSION_UNAVAILABLE");
  assert.equal((await probeMemberSite(origin, { fetchImpl: async () => { throw new Error("offline"); } })).code, "REQUEST_FAILED");
  for (const value of ["http://train.example.com", "https://user:password@train.example.com", "https://train.example.com/path"]) {
    await assert.rejects(probeMemberSite(value, { fetchImpl }), /Invalid member site origin/);
  }
});
