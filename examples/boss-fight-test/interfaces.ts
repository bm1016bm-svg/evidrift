export type BossFightOptions<Metadata extends Record<string, unknown> = Record<string, never>> =
  Readonly<{
    mode: 'strict' | 'adaptive';
    retry?: {
      attempts: 1 | 2 | 3;
      backoffMs: readonly [number, ...number[]];
    };
    rules: readonly (
      { kind: 'allow'; pattern: `${string}:${string}` } | { kind: 'deny'; reason?: string }
    )[];
    metadata?: Metadata;
  }>;

export interface TextVictory {
  kind: 'text';
  normalized: string;
}

export interface NumericVictory {
  kind: 'number';
  value: number;
}

export interface BinaryVictory {
  kind: 'binary';
  bytes: Uint8Array;
}
