declare const __CLI_VERSION__: string | undefined;

export const VERSION: string = typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";

export const NODE_VERSION: string = process.versions.node;

export const PLATFORM: string = `${process.platform}-${process.arch}`;

export function versionLine(binName: string): string {
  return `${binName}/${VERSION} node-v${NODE_VERSION} ${PLATFORM}`;
}

export function userAgent(product: string): string {
  return `${product}-cli/${VERSION} node/${NODE_VERSION} ${PLATFORM}`;
}
