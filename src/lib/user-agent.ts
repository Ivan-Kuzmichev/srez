/**
 * Just enough User-Agent parsing for «Safari, macOS» in the sessions table and a default passkey
 * name. Order matters: many browsers carry «Safari» and «Chrome» tokens.
 */
export interface UserAgentInfo {
  browser: string | null;
  os: string | null;
  /** Device family for naming a passkey: Mac, iPhone, iPad, Android, Windows, Linux. */
  device: string | null;
}

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bYaBrowser\//, 'Яндекс Браузер'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/Chrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

export function parseUserAgent(ua: string | null | undefined): UserAgentInfo {
  if (!ua) return { browser: null, os: null, device: null };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;

  let os: string | null = null;
  let device: string | null = null;
  if (/\biPhone\b/.test(ua)) [os, device] = ['iPhone', 'iPhone'];
  else if (/\biPad\b/.test(ua)) [os, device] = ['iPad', 'iPad'];
  else if (/\bAndroid\b/.test(ua)) [os, device] = ['Android', 'Android'];
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) [os, device] = ['macOS', 'Mac'];
  else if (/\bWindows\b/.test(ua)) [os, device] = ['Windows', 'Windows'];
  else if (/\bCrOS\b/.test(ua)) [os, device] = ['ChromeOS', 'Chromebook'];
  else if (/\bLinux\b/.test(ua)) [os, device] = ['Linux', 'Linux'];
  return { browser, os, device };
}

/** «Safari, macOS»; whatever is known, or null. */
export function describeUserAgent(ua: string | null | undefined): string | null {
  const { browser, os } = parseUserAgent(ua);
  return [browser, os].filter(Boolean).join(', ') || null;
}
