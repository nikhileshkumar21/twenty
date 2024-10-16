import { Inject, Injectable } from '@nestjs/common';

import {
  ServerlessDriver,
  ServerlessExecuteResult,
} from 'src/engine/core-modules/serverless/drivers/interfaces/serverless-driver.interface';

import { SERVERLESS_DRIVER } from 'src/engine/core-modules/serverless/serverless.constants';
import { Runtime } from 'src/engine/core-modules/serverless/drivers/enums/runtime.enum';

@Injectable()
export class ServerlessService implements ServerlessDriver {
  constructor(@Inject(SERVERLESS_DRIVER) private driver: ServerlessDriver) {}

  async delete(serverlessFunctionId: string): Promise<void> {
    return this.driver.delete(serverlessFunctionId);
  }

  async build(params: {
    workspaceId: string;
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    layerVersion: number | null;
    runtime: Runtime;
  }): Promise<void> {
    return this.driver.build(params);
  }

  async publish(params: {
    workspaceId: string;
    serverlessFunctionId: string;
    currentServerlessFunctionVersion: string | null;
    layerVersion: number | null;
    runtime: Runtime;
  }): Promise<string> {
    return this.driver.publish(params);
  }

  async execute(params: {
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    payload: object;
  }): Promise<ServerlessExecuteResult> {
    return this.driver.execute(params);
  }
}
