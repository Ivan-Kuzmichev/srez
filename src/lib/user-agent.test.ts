import { describe, expect, it } from 'vitest';
import { describeUserAgent, parseUserAgent } from './user-agent';

const UA = {
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  yandex:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/25.8.0.0 Safari/537.36',
};

describe('describeUserAgent', () => {
  it('names browser and system', () => {
    expect(describeUserAgent(UA.safariMac)).toBe('Safari, macOS');
    expect(describeUserAgent(UA.safariIphone)).toBe('Safari, iPhone');
    expect(describeUserAgent(UA.chromeWin)).toBe('Chrome, Windows');
    expect(describeUserAgent(UA.edgeWin)).toBe('Edge, Windows');
    expect(describeUserAgent(UA.firefoxLinux)).toBe('Firefox, Linux');
    expect(describeUserAgent(UA.chromeAndroid)).toBe('Chrome, Android');
    expect(describeUserAgent(UA.yandex)).toBe('Яндекс Браузер, Windows');
  });

  it('copes with nothing useful', () => {
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent('curl/8.0')).toBeNull();
    expect(parseUserAgent(UA.safariMac).device).toBe('Mac');
  });
});
