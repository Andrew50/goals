/// <reference types="react-scripts" />
/// <reference types="node" />

// Some tooling environments (including Cursor diagnostics) occasionally fail to resolve
// `@mui/icons-material/*` type declarations even though they exist in node_modules.
// This keeps editor/lint diagnostics stable without impacting runtime behavior.
declare module '@mui/icons-material/*' {
  const Component: any;
  export default Component;
}





