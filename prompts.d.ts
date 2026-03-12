declare module "prompts" {
  export interface Choice {
    title: string;
    value: unknown;
    description?: string;
    disabled?: boolean;
    selected?: boolean;
  }

  export interface PromptObject {
    type?: string | null;
    name?: string;
    message?: string;
    initial?: unknown;
    validate?: (value: never) => true | string | Promise<true | string>;
    choices?: Choice[];
    min?: number;
    max?: number;
    float?: boolean;
  }

  export interface Options {
    onCancel?: () => boolean | void;
  }

  export type PromptResult = Record<string, unknown>;

  export default function prompts(
    prompts: PromptObject | PromptObject[],
    options?: Options
  ): Promise<PromptResult>;
}
