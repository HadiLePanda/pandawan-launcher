//! Writes `src/lib/bindings.ts` from the live command and event definitions.
//!
//! Why this exists rather than the in-binary debug auto-export it replaces: that
//! path only ran under `#[cfg(debug_assertions)]` inside `run()`, which means
//! launching the whole Tauri application just to print a file. This calls
//! `create_specta_builder()` directly and never opens a window.
//!
//! ## This binary does not run on this machine
//!
//! It dies at load on Windows with STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139),
//! before main() prints a line. This is NOT fixed by --release: a release build
//! from this exact source fails identically (verified 2026-10-04). A release
//! binary built earlier does run, so the difference is a stale artifact, not the
//! profile - do not trust an old exe as evidence that the current source works.
//!
//! What is ruled out, so none of it is re-tried:
//!
//!   - A missing WebView2 runtime. The runtime is installed (154.0.4258.53), and
//!     the binary's 339 static imports all resolve.
//!   - A missing WebView2Loader.dll. webview2-com-sys is not in the import table
//!     at all, and putting the DLL beside the binary changes nothing.
//!   - A missing MSVC runtime. VCRUNTIME140 and friends all load.
//!   - default-features = false on tauri. The launcher is a GUI app whose lib uses
//!     wry types, so this fails to compile with 30 errors.
//!   - Dropping the handler table. Commands<R> stores an Arc<dyn Fn(Invoke<R>)>,
//!     so the runtime arrives with the type collection.
//!
//! `collect_commands!` expands to `tauri::generate_handler!`, whose static
//! per-command table pins webview2-com-sys's DllMain - registered through the
//! `ctor` crate - into any process that links it, and that DllMain is what fails
//! to resolve. Any process referencing create_specta_builder dies the same way,
//! including a test binary, which is why this cannot be probed from a unit test.
//!
//! Working around it means regenerating bindings on a machine where this runs,
//! or getting a WebView2 fix upstream. Run it, reconcile the output against
//! src/types/index.ts, and let bindings-parity.test.ts prove the command list
//! survived - that test is the guard, and it passes on the committed file.
//!
//! It lives in `src-tauri/export-bindings/` rather than as `src-tauri/src/bin/`
//! because a second binary in the app crate breaks the macOS bundle - see this
//! package's Cargo.toml.
//!
//! Run with: `cargo run -p export-bindings`
//!
//! The output is NOT ready to commit as-is. specta-typescript 0.0.12 emits
//! snake_case fields and `| null` optionals, which drift from the frontend's
//! source-of-truth types in `src/types/index.ts`. The export is therefore a
//! starting point that still needs reconciling; the parity test in
//! `src/lib/bindings-parity.test.ts` is what proves the command list survived
//! that reconciliation intact.
//!
//! Event tag names are the exception: `DownloadEvent` has no enum-level
//! rename, so serde emits the variant names as-is (`Started`, `FileComplete`),
//! and `src/lib/download-channel.ts` matches on those exact strings.
//! camelCasing them while reconciling silently starves the progress bar.

use std::path::PathBuf;

use specta_typescript::Typescript;

fn main() {
    let bindings_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/lib/bindings.ts");

    pandawan_launcher_lib::create_specta_builder()
        .export(Typescript::default(), bindings_path)
        .expect("failed to export TypeScript bindings");

    println!("Wrote src/lib/bindings.ts");
    println!("Reconcile before committing: the raw output uses tabs, double quotes and");
    println!("snake_case fields, and marks optional fields `| null` rather than optional.");
}
