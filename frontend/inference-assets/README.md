# Browser runtime build

Source: demucs-rs v0.3.5, commit `805d6f72ede20282832ac78c634e8767716c0b21`.
Compiler: rustc 1.94.0, wasm-bindgen CLI 0.2.108, target wasm32-unknown-unknown.
Apply runtime-lite-v1.patch to disable Burn's autotune features while retaining
WebGPU + fusion. This avoids the optional timestamp-query profiling path that
panics on browser GPU readback and removes repeated kernel benchmarking.
No model weights, network layers or separation math are modified.

Rebuild from the pinned source:

```sh
git apply /path/to/runtime-lite-v1.patch
cargo +1.94.0 build -p demucs-wasm --target wasm32-unknown-unknown --release -j 2
wasm-bindgen --target web --out-name runtime-lite-v1 --out-dir /tmp/stemora-bindings target/wasm32-unknown-unknown/release/demucs_wasm.wasm
```

Copy the generated JS into public/client-stems/assets/ and gzip the generated
runtime-lite-v1_bg.wasm here. Update its decompressed SHA-256 and byte count in
public/client-stems/assets.json when rebuilding. prepare-client-stems.mjs expands
this packaged asset and verifies it before every development/production build.
The browser downloads the expanded WASM from the app's own origin.
All upstream license/notice files remain in public/client-stems/.
