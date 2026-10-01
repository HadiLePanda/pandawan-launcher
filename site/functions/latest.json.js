/**
 * Serves the launcher's updater manifest to the browser.
 *
 * The bucket itself cannot be called from the page: R2 sends no
 * Access-Control-Allow-Origin on a public bucket unless CORS rules are added,
 * and a browser will refuse to read a cross-origin response without one. Rather
 * than requiring a bucket configuration change, this function fetches the
 * manifest server-side, where CORS does not apply, and returns it.
 *
 * Configuration
 * -------------
 * The manifest location is not hard-coded. Set a plain text environment
 * variable in Cloudflare Pages (Settings -> Environment variables):
 *
 *   MANIFEST_URL  the full URL of the updater manifest
 *
 * The fallback below only exists so `wrangler pages dev` works before anything
 * is configured. In a deployed environment the variable is what is used, so a
 * bucket or domain change is a dashboard edit rather than a code change and
 * redeploy.
 *
 * This is a pure read proxy: it takes no input, touches no credentials, and
 * forwards nothing the visitor sent.
 */

const DEFAULT_MANIFEST_URL =
  'https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev/launcher/latest.json';

export async function onRequestGet({ env }) {
  const manifestUrl = env?.MANIFEST_URL || DEFAULT_MANIFEST_URL;

  if (!manifestUrl.startsWith('https://')) {
    // A misconfigured value would otherwise be fetched and reported as a bucket
    // outage, which sends the reader looking in the wrong place.
    return new Response(JSON.stringify({ error: 'MANIFEST_URL must be an https URL.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const upstream = await fetch(manifestUrl, { cf: { cacheTtl: 0 } });

    if (!upstream.ok) {
      // 404 here means nothing has been published yet, which is a normal state
      // rather than a server fault.
      return new Response(
        JSON.stringify({ error: 'No release is published yet.', status: upstream.status }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(upstream.body, {
      headers: {
        'content-type': 'application/json',
        // Always revalidate: the manifest is the thing that changes on a
        // release, and a cached copy means the page keeps advertising the old
        // version after a new one ships.
        'cache-control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Could not reach the release bucket.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
