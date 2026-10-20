// The slice of libheif-js's Emscripten build that src/lib/heic.ts uses. The
// package ships typings for the raw C API only, not for this entry point.

declare module 'libheif-js/libheif-wasm/libheif.js' {
  export interface HeifImage {
    get_width(): number
    get_height(): number
    is_primary(): boolean
    display(
      target: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number },
      done: (out: { data: Uint8ClampedArray<ArrayBuffer> } | null) => void,
    ): void
    free(): void
  }

  export interface HeifModule {
    HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] }
    calledRun?: boolean
    onRuntimeInitialized?: () => void
  }

  export interface HeifOptions {
    locateFile?: (path: string) => string
    wasmBinary?: Uint8Array
    onRuntimeInitialized?: () => void
  }

  const factory: (opts?: HeifOptions) => HeifModule
  export default factory
}
