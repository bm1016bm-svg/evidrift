import type { BinaryVictory, BossFightOptions, NumericVictory, TextVictory } from './interfaces.js';

export declare function bossFight(
  input: string,
  options: BossFightOptions<{ locale: string }>,
): TextVictory;

export declare function bossFight(
  input: number,
  options: BossFightOptions<{ radix: 2 | 8 | 10 | 16 }>,
): NumericVictory;

export declare function bossFight(
  input: Uint8Array,
  options: BossFightOptions<{ encoding: 'raw' | 'base64' }>,
): BinaryVictory;
