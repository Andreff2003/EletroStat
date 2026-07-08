declare module "ml-levenberg-marquardt" {
  export interface LMOptions {
    initialValues?: number[];
    damping?: number;
    maxIterations?: number;
    errorTolerance?: number;
    minValues?: number[];
    maxValues?: number[];
    weights?: number[] | number;
    gradientDifference?: number | number[];
    centralDifference?: boolean;
    timeout?: number;
  }
  export interface LMResult {
    parameterValues: number[];
    parameterError: number;
    iterations: number;
  }
  export function levenbergMarquardt(
    data: { x: number[]; y: number[] },
    parameterizedFunction: (params: number[]) => (x: number) => number,
    options?: LMOptions,
  ): LMResult;
}
