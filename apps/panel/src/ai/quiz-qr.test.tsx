import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuizQr } from './quiz-qr.js';

describe('QuizQr', () => {
  it('renders an <svg> at the given size', () => {
    const { container } = render(<QuizQr value="https://quiz.eduscope.local/j/482913" size={240} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '240');
    expect(svg).toHaveAttribute('height', '240');
    expect(svg.querySelector('rect')).toHaveAttribute('fill', '#ffffff');
  });

  it('the same joinUrl renders identical output twice (pure function of its prop)', () => {
    const a = render(<QuizQr value="https://quiz.eduscope.local/j/482913" size={240} />);
    const b = render(<QuizQr value="https://quiz.eduscope.local/j/482913" size={240} />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
  });

  it('a different value produces a different code', () => {
    const a = render(<QuizQr value="https://quiz.eduscope.local/j/482913" size={240} />);
    const b = render(<QuizQr value="https://quiz.eduscope.local/j/111111" size={240} />);
    expect(a.container.innerHTML).not.toBe(b.container.innerHTML);
  });

  it('carries the value as accessible text, not only a picture', () => {
    const { container } = render(<QuizQr value="https://quiz.eduscope.local/j/482913" size={240} />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-label',
      'Join QR. Or go to https://quiz.eduscope.local/j/482913.',
    );
  });
});
