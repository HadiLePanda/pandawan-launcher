import { useEffect, useRef, useState } from 'react';

import type { DownloadProgressSnapshot } from './download-channel';

/** Roughly 90 seconds at the backend's ~500ms progress cadence. */
const HISTORY_LENGTH = 60;

export interface SpeedSample {
  /** Bytes per second at this point in the transfer. */
  bytesPerSecond: number;
}

/**
 * Throughput history for one transfer, newest last.
 *
 * Derived from `downloadedBytes`, not from the snapshot's own `speed` string:
 * that string is already formatted for display ("12.4 MB/s"), and a graph needs
 * a number. Sampling on byte movement also means a stalled transfer contributes
 * a zero rather than being skipped, which is the shape the graph is for.
 *
 * The ring is a ref, not state. It is read during render to draw, but written
 * only from a timer, and pushing it into state would re-render every consumer of
 * the row several times a second for a value that only the graph reads.
 */
export function useSpeedHistory(snapshot: DownloadProgressSnapshot | undefined): SpeedSample[] {
  const [samples, setSamples] = useState<SpeedSample[]>([]);
  const lastBytesRef = useRef(snapshot?.downloadedBytes ?? 0);
  const lastAtRef = useRef(0);

  useEffect(() => {
    const now = performance.now();
    const bytes = snapshot?.downloadedBytes ?? 0;
    const lastAt = lastAtRef.current;
    const lastBytes = lastBytesRef.current;

    // First sample of a transfer: there is no interval yet, so there is no rate.
    // Seeding it with the reported string's magnitude would put a spike at the
    // left edge that never happened.
    if (lastAt !== 0) {
      const seconds = (now - lastAt) / 1000;
      const bytesPerSecond = seconds > 0 ? Math.max(0, (bytes - lastBytes) / seconds) : 0;
      setSamples((prev) => [...prev, { bytesPerSecond }].slice(-HISTORY_LENGTH));
    }

    lastBytesRef.current = bytes;
    lastAtRef.current = now;
  }, [snapshot?.downloadedBytes]);

  return samples;
}

/**
 * SVG path for a speed graph, plus the peak so the caller can scale.
 *
 * A polyline rather than a filled area would need a second path and a second
 * set of numbers to stay in sync with this one; the filled shape is the same
 * points closed to the baseline.
 */
export function speedGraphPath(
  samples: SpeedSample[],
  width: number,
  height: number
): {
  line: string;
  area: string;
  peak: number;
} {
  if (samples.length < 2) return { line: '', area: '', peak: 0 };

  const peak = Math.max(...samples.map((s) => s.bytesPerSecond), 1);
  const stepX = width / (HISTORY_LENGTH - 1);
  // Right-aligned: the newest sample is the one the reader cares about, so it
  // sits at the right edge and older samples trail off to the left.
  const offset = width - (samples.length - 1) * stepX;

  const points = samples.map((sample, i) => {
    const x = offset + i * stepX;
    const y = height - (sample.bytesPerSecond / peak) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = `M${points.join('L')}`;
  const area = `${line}L${(offset + (samples.length - 1) * stepX).toFixed(1)},${height}L${offset.toFixed(1)},${height}Z`;

  return { line, area, peak };
}
