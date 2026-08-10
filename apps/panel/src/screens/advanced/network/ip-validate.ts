/** Pure IPv4/CIDR checks — no I/O. */
export function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function isValidCidr(value: string): boolean {
  const [address, prefix] = value.split('/');
  if (!address || prefix === undefined) return false;
  if (!isValidIpv4(address)) return false;
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const p = Number(prefix);
  return p >= 0 && p <= 32;
}
