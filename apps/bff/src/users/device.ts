// Label perangkat singkat dari User-Agent, mis. "Chrome · Windows". Tanpa dependensi.

const UNKNOWN = "Perangkat tidak dikenal";

// Urutan penting: Edge/Opera/Chrome semuanya memuat "Chrome/" atau "Safari/".
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"]
];

// Urutan penting: UA iPhone memuat "Mac OS X", UA Android memuat "Linux".
const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"]
];

export function deviceLabel(ua: string | null | undefined): string {
  const s = (ua ?? "").trim();
  if (!s) return UNKNOWN;
  if (/^curl\//i.test(s)) return "curl";
  if (/^(node|undici)\b/i.test(s)) return "Node.js · Server";
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(s))?.[1];
  if (browser && system) return `${browser} · ${system}`;
  if (system) return `Browser lain · ${system}`;
  return browser ?? UNKNOWN;
}
