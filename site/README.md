# Pandawan website

The public download page. Static HTML/CSS/JS plus one Cloudflare Pages Function.

It shows **only the current release**, read from the same updater manifest
(`latest.json`) that the launcher itself polls. There is no second list of
versions to maintain, so the page can never advertise a download the launcher
would refuse to install.

## Deploy to Cloudflare Pages

No domain is needed — Pages assigns a free `*.pages.dev` address.

```bash
npm install -g wrangler
wrangler pages deploy . --project-name pandawan-site
```

Connect the Git repository instead if you would rather have deploys tied to
pushes: create the project in the dashboard once, then attach the repo.

### Configuration

Set one plain text environment variable in **Pages → Settings → Environment
variables** (both Production and Preview):

| Variable       | Value                                               |
| -------------- | --------------------------------------------------- |
| `MANIFEST_URL` | `https://<your-bucket>.r2.dev/launcher/latest.json` |

This is not hard-coded in the deployed function — changing bucket or domain is a
dashboard edit, not a code change and redeploy. A built-in fallback exists only so
the site works locally before anything is configured.

## Why the manifest is proxied

`functions/latest.json.js` fetches the manifest server-side instead of the
browser fetching the bucket directly. R2 sends no `Access-Control-Allow-Origin`
on a public bucket unless CORS rules are added, and a browser refuses to read a
cross-origin response without one. Proxying avoids requiring any bucket
configuration. The function is a pure read: no input, no credentials, nothing
forwarded from the visitor.

## Local checks

```bash
node site/verify.mjs
```

Prints what the page would render from the live manifest and HEADs every download
to confirm it resolves. Run it after publishing a release.

To serve the page locally with the function working:

```bash
npx wrangler pages dev site
```

## Layout

```
site/
├── index.html            the page
├── style.css             styling
├── app.js                manifest → download buttons
├── functions/
│   └── latest.json.js    CORS-free read proxy for the manifest
└── verify.mjs            checks the page against the live manifest
```

`verify.mjs` is a developer tool and is not needed in production; Pages serves
whatever is in the folder and the file is simply never requested.
