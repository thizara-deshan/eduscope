import { describe, expect, it } from 'vitest';
import { isValidCidr, isValidIpv4 } from './ip-validate.js';

describe('isValidIpv4', () => {
  it('accepts a normal dotted quad', () => {
    expect(isValidIpv4('10.20.4.12')).toBe(true);
  });
  it('rejects an out-of-range octet', () => {
    expect(isValidIpv4('999.1.1.1')).toBe(false);
  });
  it('rejects a non-4-part string', () => {
    expect(isValidIpv4('10.20.4')).toBe(false);
  });
});

describe('isValidCidr', () => {
  it('accepts a normal CIDR', () => {
    expect(isValidCidr('10.20.4.0/24')).toBe(true);
  });
  it('rejects a prefix out of range', () => {
    expect(isValidCidr('10.20.4.0/99')).toBe(false);
  });
  it('rejects a bad address', () => {
    expect(isValidCidr('999.1.1.1/24')).toBe(false);
  });
});
