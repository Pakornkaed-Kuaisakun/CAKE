export interface AgentTool {
  name: string;
  description: string;
  /** Example invocation string shown to the planner */
  example: string;
}

export interface ThoughtStep {
  thought: string;
  tool: string;
  input: string;
}

export interface StepResult {
  step: number;
  thought: string;
  tool: string;
  input: string;
  output: string;
  success: boolean;
}

export interface AutonomousResult {
  goal: string;
  steps: StepResult[];
  finalAnswer: string;
  success: boolean;
  stepsUsed: number;
}
