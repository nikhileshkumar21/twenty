import { ServerlessFunctionExecutionStatus } from 'src/modules/serverless/dtos/serverless-function-execution-result.dto';
import { Runtime } from 'src/engine/core-modules/serverless/drivers/enums/runtime.enum';

export type ServerlessExecuteError = {
  errorType: string;
  errorMessage: string;
  stackTrace: string;
};

export type ServerlessExecuteResult = {
  data: object | null;
  duration: number;
  status: ServerlessFunctionExecutionStatus;
  error?: ServerlessExecuteError;
};

export interface ServerlessDriver {
  delete(serverlessFunctionId: string): Promise<void>;
  build(params: {
    workspaceId: string;
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    layerVersion: number | null;
    runtime: Runtime;
  }): Promise<void>;
  publish(params: {
    workspaceId: string;
    serverlessFunctionId: string;
    currentServerlessFunctionVersion: string | null;
    layerVersion: number | null;
    runtime: Runtime;
  }): Promise<string>;
  execute(params: {
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    payload: object;
  }): Promise<ServerlessExecuteResult>;
}
