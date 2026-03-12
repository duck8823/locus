export interface DogfoodingJobRecord {
  reviewId?: string;
  reason?: string;
  status?: string;
  durationMs?: number | null;
}

export interface DogfoodingMetrics {
  totalJobs: number;
  terminalJobs: number;
  averageDurationMs: number | null;
  failureRatePercent: number | null;
  recoverySuccessRatePercent: number | null;
}

export interface RunDogfoodingMetricsParams {
  jobsFilePath?: string;
}

export interface RunDogfoodingMetricsResult {
  generatedAt: string;
  jobsFilePath: string;
  global: DogfoodingMetrics;
  byReview: Array<{ reviewId: string } & DogfoodingMetrics>;
}

export function toFixedOneDecimal(value: number): number;
export function loadJobs(rawStore: unknown): DogfoodingJobRecord[];
export function calculateMetrics(jobs: DogfoodingJobRecord[]): DogfoodingMetrics;
export function groupByReviewId(jobs: DogfoodingJobRecord[]): Map<string, DogfoodingJobRecord[]>;
export function runDogfoodingMetrics(params?: RunDogfoodingMetricsParams): Promise<RunDogfoodingMetricsResult>;
