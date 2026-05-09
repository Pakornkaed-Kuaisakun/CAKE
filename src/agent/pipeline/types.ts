export interface PipelineStep {
  command: string;
  args: string;
  raw: string;
}

export interface PipelineResult {
  text: string;
  steps: string[];
  isPipeline: boolean;
}
