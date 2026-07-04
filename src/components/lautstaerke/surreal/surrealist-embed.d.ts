// `@frachter-app/surrealist` is an OPTIONAL, lazily dynamic-imported dependency
// (a pre-release embed in a separate fork repo). It may not be installed, so
// declare its minimal shape here to keep the codebase type-checking without it.
// When the real package is installed, its own types take precedence.
declare module '@frachter-app/surrealist' {
  import type {ComponentType, CSSProperties} from 'react';
  export const Surrealist: ComponentType<{
    connection: {protocol: 'opfs' | 'indxdb' | 'mem'; address: string};
    views?: Array<'explorer' | 'query'>;
    theme?: 'dark' | 'light';
    style?: CSSProperties;
  }>;
}
