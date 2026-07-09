import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingScreen } from './LoadingScreen';

describe('LoadingScreen', () => {
  it('renders the launcher mark and provided status when open', () => {
    const html = renderToStaticMarkup(
      <LoadingScreen isOpen status="Loading catalog…" />
    );

    expect(html).toContain('Loading catalog…');
    expect(html).toContain('Pandawan');
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<LoadingScreen isOpen={false} />);

    expect(html).toBe('');
  });

  it('falls back to a default status when none is provided', () => {
    const html = renderToStaticMarkup(<LoadingScreen isOpen />);

    expect(html).toContain('Loading…');
  });
});
