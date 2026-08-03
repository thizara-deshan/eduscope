import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
const value = (name: string) =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('design tokens (screen-inventory §8)', () => {
  it('carries the §8.1 light palette verbatim', () => {
    expect(value('bg')).toBe('#eef0f4');
    expect(value('surface')).toBe('#ffffff');
    expect(value('text')).toBe('#1c2430');
    expect(value('border')).toBe('#d8dee9');
  });

  it('carries the §8.2 ink scope, semantics and brand', () => {
    expect(value('ink')).toBe('#101319');
    expect(value('accent')).toBe('#2f6bed');
    expect(value('record')).toBe('#e5342e');
    expect(value('success')).toBe('#1c9e6a');
    expect(value('warning')).toBe('#d98a12');
    expect(value('brand-red')).toBe('#e5231f');
  });

  it('adds the two §8.2 semantics that the prototype lacks', () => {
    expect(value('danger')).toBe('#c62828');
    expect(value('info')).toBe('#2f6bed');
  });

  it('declares the full §8.4 type scale', () => {
    for (const [token, px] of [
      ['fs-3xs', '11px'], ['fs-2xs', '12px'], ['fs-xs', '13px'], ['fs-sm', '14px'],
      ['fs-base', '15px'], ['fs-md', '16px'], ['fs-lg', '17px'], ['fs-xl', '19px'],
      ['fs-2xl', '21px'], ['fs-3xl', '24px'], ['fs-timer', '38px'], ['fs-display', '46px'],
    ] as const) {
      expect(value(token), `--${token}`).toBe(px);
    }
  });

  it('declares the §8.5 2px spacing grid', () => {
    expect(value('sp-1')).toBe('4px');
    expect(value('sp-3')).toBe('8px');
    expect(value('sp-10')).toBe('24px');
  });

  it('applies the §8.6 radius rename in one place', () => {
    expect(value('radius-md')).toBe('12px');
    expect(value('radius-lg')).toBe('14px'); // reassigned from the prototype's 24px
    expect(value('radius-xl')).toBe('24px');
    expect(value('radius-panel')).toBe('20px');
  });

  it('declares the §8.7 layout constants', () => {
    expect(value('panel-w')).toBe('1280px');
    expect(value('panel-h')).toBe('800px');
    expect(value('header-h')).toBe('62px');
    expect(value('sidebar-w')).toBe('430px');
    expect(value('tap-min')).toBe('44px');
  });

  it('re-declares the ink scope inside .us-assistant rather than forking classes', () => {
    expect(css).toMatch(/\.us-assistant\s*\{[^}]*--surface:\s*#1e242f/s);
    expect(css).toMatch(/\.us-assistant\s*\{[^}]*--text:\s*#f2f4f8/s);
  });

  it('keeps the reduced-motion escape hatch', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});
