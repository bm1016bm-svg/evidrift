export interface ParseOptions {
  strict?: boolean;
}

export interface ParseResult {
  value: string;
}

export declare function parseConfig(input: string, options?: ParseOptions): ParseResult;
