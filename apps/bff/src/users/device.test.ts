import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceLabel } from "./device.js";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const cases: Array<[string, string | null | undefined, string]> = [
  ["Chrome Windows", CHROME_WIN, "Chrome · Windows"],
  ["Edge Windows", CHROME_WIN + " Edg/131.0.0.0", "Edge · Windows"],
  ["Safari iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari · iPhone"],
  ["Chrome iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1", "Chrome · iPhone"],
  ["Safari macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari · macOS"],
  ["Firefox Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox · Linux"],
  ["Chrome Android (sebelum Linux)", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Chrome · Android"],
  ["curl", "curl/8.7.1", "curl"],
  ["node", "node", "Node.js · Server"],
  ["undici", "undici", "Node.js · Server"],
  ["kosong", "", "Perangkat tidak dikenal"],
  ["null", null, "Perangkat tidak dikenal"],
  ["undefined", undefined, "Perangkat tidak dikenal"],
  ["browser lain", "Foo/1.0 (Windows NT 10.0)", "Browser lain · Windows"]
];

for (const [name, ua, expected] of cases) {
  test(`deviceLabel: ${name}`, () => assert.equal(deviceLabel(ua), expected));
}
