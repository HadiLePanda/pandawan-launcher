//! Writes `src/lib/bindings.ts` from the live command and event definitions.
//!
//! Why this exists rather than the in-binary debug auto-export it replaces: that
//! path only ran under `#[cfg(debug_assertions)]` inside `run()`, which means
//! launching the whole Tauri application just to print a file. Worse, on a
//! Windows host the lib test binary could not even reach that point - it links
//! `webview2-com-sys`, which resolves the WebView2 loader when the process
//! loads, so without that runtime the process dies with
//! STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139) before any code runs. A tool whose
//! job is to regenerate a file has to work on a machine with no GUI stack, so
//! this calls `create_specta_builder()` directly and never opens a window.
//!
//! Run with: `cargo run --bin export-bindings`
//!
//! The output is NOT ready to commit as-is. specta-typescript 0.0.12 emits
//! snake_case fields, `| null` optionals and Pascal event names, all of which
//! drift from the frontend's source-of-truth types in `src/types/index.ts`. The
//! export is therefore a starting point that still needs reconciling; the parity
//! test in `src/lib/bindings-parity.test.ts` is what proves the command list
//! survived that reconciliation intact.

use std::path::PathBuf;

use specta_typescript::Typescript;

fn main() {
    let bindings_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/lib/bindings.ts");

    pandawan_launcher_lib::create_specta_builder()
        .export(Typescript::default(), bindings_path)
        .expect("failed to export TypeScript bindings");

    println!("Wrote src/lib/bindings.ts");
    println!("Reconcile before committing: the raw output uses tabs, double quotes and");
    println!("snake_case fields, and marks optional fields `| null` rather than optional.");
}
