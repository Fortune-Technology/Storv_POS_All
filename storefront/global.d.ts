/**
 * Global type declarations for the storefront.
 *
 * Allows side-effect CSS imports (e.g. `import './styles.css'`) without
 * TS complaining about missing type declarations. Next.js's webpack handles
 * these at runtime; TS just needs to know the module names are valid.
 */

declare module '*.css';
declare module '*.scss';
declare module '*.sass';
