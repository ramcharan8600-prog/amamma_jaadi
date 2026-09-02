import { describe, expect, it } from 'vitest';

import { buildCsp } from './middleware';

describe('checkout Content Security Policy', () => {
  it('allows issuer-hosted HTTPS frames and 3-D Secure form submissions', () => {
    const csp = buildCsp();

    expect(csp).toContain("frame-src 'self' https:");
    expect(csp).toContain("form-action 'self' https:");
  });
});
