export type PoolPrepareResult = {
  tag: string;
  requested: number;
  existing: number;
  created: number;
  failed: number;
  skipped: boolean;
  errors: string[];
};
