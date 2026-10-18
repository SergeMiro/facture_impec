import { describe, expect, it } from 'vitest';
import { el, req, serialize } from './writer';

describe('XML writer', () => {
  it('leaves out elements without content, at any depth', () => {
    expect(el('a', {}, undefined, null, false, '  ', [undefined, []])).toBeUndefined();
    expect(el('a', {}, el('b', {}, el('c')))).toBeUndefined();
  });

  it('writes required elements even when empty', () => {
    expect(serialize(req('a', {}, el('b')))).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<a/>\n');
  });

  it('escapes text and attributes, trims them and drops empty attributes', () => {
    const xml = serialize(
      req('a', { x: ' "1" & <2> ', y: '', z: undefined }, ' Tom & "Jerry" <3 '),
    );
    expect(xml).toContain('<a x="&quot;1&quot; &amp; &lt;2&gt;">Tom &amp; "Jerry" &lt;3</a>');
  });

  it('drops characters XML 1.0 cannot carry', () => {
    expect(serialize(req('a', {}, 'A\u0000B\u0007C\u000BD\u001FE\tF￾G'))).toContain(
      '<a>ABCDE\tFG</a>',
    );
  });

  it('indents nested elements and keeps mixed content', () => {
    expect(serialize(req('a', {}, el('b', {}, 'x'), 'text', [el('c', {}, 'y')]))).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<a>',
        '  <b>x</b>',
        '  text',
        '  <c>y</c>',
        '</a>',
        '',
      ].join('\n'),
    );
  });
});
