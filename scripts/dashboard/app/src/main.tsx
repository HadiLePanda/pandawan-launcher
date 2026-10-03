/**
 * Entry point.
 *
 * StrictMode is deliberately NOT enabled. Its double-invoked effects would fire
 * every draft adoption twice, so the first pass adopts a stored draft and the
 * second pass sees the form already dirty and writes the draft back over the
 * freshly loaded values - restoring an edit on top of itself. The behaviour it
 * would catch (effects not cleaning up) is checked by the explicit cleanup
 * functions in this tree instead.
 */

import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  // Without this the failure is a blank page and a null deref in the console,
  // which says nothing about which file is missing from index.html.
  throw new Error('index.html has no #root element to mount into');
}

createRoot(container).render(<App />);
