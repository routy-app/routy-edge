import { test } from "node:test";
import assert from "node:assert/strict";
import { cloakedHtml } from "../src/services/cloaked.js";

test("renders meta-refresh with no-referrer", () => {
  const html = cloakedHtml("https://example.com/lp?x=1");
  assert.match(html, /<meta name="referrer" content="no-referrer"/);
  assert.match(html, /<meta http-equiv="refresh" content="0;URL='https:\/\/example.com\/lp\?x=1'"/);
});

test("escapes single quotes (would break the meta attribute)", () => {
  const html = cloakedHtml("https://x/?q=O'Reilly");
  assert.ok(!html.includes("O'Reilly"), "raw apostrophe leaked into HTML");
  assert.match(html, /O&#39;Reilly/);
});

test("escapes ampersands (would break URLs)", () => {
  const html = cloakedHtml("https://x/?a=1&b=2");
  assert.match(html, /a=1&amp;b=2/);
});

test("escapes angle brackets (would break HTML)", () => {
  const html = cloakedHtml("https://x/?q=<script>");
  assert.match(html, /q=&lt;script&gt;/);
  assert.ok(!html.includes("<script>"), "raw <script> leaked into HTML");
});

test("escapes double quotes", () => {
  const html = cloakedHtml(`https://x/?q="hi"`);
  assert.match(html, /q=&quot;hi&quot;/);
});
