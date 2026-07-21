import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("page is a relative-path 240x282 Rabbit creation", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(html, /width=240/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/js\/app\.js"/);
  assert.match(html, /id="time"/);
  assert.match(html, /id="settingsForm"/);
  assert.match(css, /width:\s*240px/);
  assert.match(css, /height:\s*282px/);
});
