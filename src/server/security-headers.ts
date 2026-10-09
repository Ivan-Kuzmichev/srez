/**
 * Response headers of every page (docs/07-auth-security.md, phase 10): a strict CSP with a per-request
 * nonce — Next.js puts it on its own scripts — and the usual guards. HTTPS-only parts (HSTS, upgrading
 * requests) apply only when APP_URL is https: on http://nas:3000 at home they would break the app.
 */
export function securityHeaders(
  nonce: string,
  options: { https: boolean; dev: boolean },
): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ''}`,
    // Scripts are strict; styles are not: React inserts <style> tags during client navigation without
    // the nonce, and pages set style attributes (bar widths, chart positions). CSS cannot carry data
    // out: url() follows img-src and font-src, which allow only this host.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    ...(options.https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}
