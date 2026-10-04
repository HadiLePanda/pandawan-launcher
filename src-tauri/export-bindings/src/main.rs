//! Writes `src/lib/bindings.ts` from the live command and event definitions.
//!
//! Why this exists rather than the in-binary debug auto-export it replaces: that
//! path only ran under `#[cfg(debug_assertions)]` inside `run()`, which means
//! launching the whole Tauri application just to print a file. This calls
//! `create_specta_builder()` directly and never opens a window.
//!
//! ## Run it with --release
//!
//! `cargo run --manifest-path src-tauri/export-bindings/Cargo.toml` builds a
//! DEBUG binary that dies at load on Windows with STATUS_ENTRYPOINT_NOT_FOUND
//! (0xC0000139), before main() prints a line. The release binary of the same
//! source runs fine on the same machine, so this is not a missing WebView2
//! runtime - it is the debug build's own import of it.
//!
//! It is not a missing DLL either: the binary's 339 static imports all resolve,
//! and webview2-com-sys is not in the import table at all. `collect_commands!`
//! expands to `tauri::generate_handler!`, whose static per-command table pins
//! webview2-com-sys's DllMain - registered through the `ctor` crate - into any
//! process that links it. Debug builds link the unwinding/runtime paths that
//! pull that entrypoint in; release builds do not.
//!
//! Turning off tauri's default features does not help: the launcher is a GUI
//! app and its lib genuinely uses wry types, so `default-features = false`
//! fails to compile with 30 errors. The handler table cannot be dropped either -
//! `Commands<R>` stores an `Arc<dyn Fn(Invoke<R>)>`, so the runtime comes with
//! the type collection.
//!
//! So the fix is the profile, not the dependency graph. If the debug build ever
//! starts failing here again, do not re-derive this: run
//! `cargo run --release --manifest-path src-tauri/export-bindings/Cargo.toml`.
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
