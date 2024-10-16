import * as fs from 'fs/promises';
import { join } from 'path';

import dotenv from 'dotenv';
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  InvokeCommand,
  InvokeCommandInput,
  Lambda,
  LambdaClientConfig,
  PublishLayerVersionCommand,
  PublishLayerVersionCommandInput,
  PublishVersionCommand,
  PublishVersionCommandInput,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
  ListLayerVersionsCommandInput,
  ListLayerVersionsCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommandInput,
} from '@aws-sdk/client-lambda';
import { CreateFunctionCommandInput } from '@aws-sdk/client-lambda/dist-types/commands/CreateFunctionCommand';
import { UpdateFunctionCodeCommandInput } from '@aws-sdk/client-lambda/dist-types/commands/UpdateFunctionCodeCommand';

import {
  ServerlessDriver,
  ServerlessExecuteResult,
} from 'src/engine/core-modules/serverless/drivers/interfaces/serverless-driver.interface';

import {
  ServerlessFunctionEntity,
  ServerlessFunctionRuntime,
} from 'src/engine/metadata-modules/serverless-function/serverless-function.entity';
import {
  LambdaBuildDirectoryManager,
  NODE_LAYER_SUBFOLDER,
} from 'src/engine/core-modules/serverless/drivers/utils/lambda-build-directory-manager';
import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { createZipFile } from 'src/engine/core-modules/serverless/drivers/utils/create-zip-file';
import { ServerlessFunctionExecutionStatus } from 'src/engine/metadata-modules/serverless-function/dtos/serverless-function-execution-result.dto';
import {
  ServerlessFunctionException,
  ServerlessFunctionExceptionCode,
} from 'src/engine/metadata-modules/serverless-function/serverless-function.exception';
import { isDefined } from 'src/utils/is-defined';
import { COMMON_LAYER_NAME } from 'src/engine/core-modules/serverless/drivers/constants/common-layer-name';
import { copyAndBuildDependencies } from 'src/engine/core-modules/serverless/drivers/utils/copy-and-build-dependencies';
import { getServerlessFolder } from 'src/engine/core-modules/serverless/utils/serverless-get-folder.utils';
import { SERVERLESS_TMPDIR_FOLDER } from 'src/engine/core-modules/serverless/drivers/constants/serverless-tmpdir-folder';
import { compileTypescript } from 'src/engine/core-modules/serverless/drivers/utils/compile-typescript';
import { ENV_FILE_NAME } from 'src/engine/core-modules/serverless/drivers/constants/env-file-name';
import { OUTDIR_FOLDER } from 'src/engine/core-modules/serverless/drivers/constants/outdir-folder';
import { Runtime } from 'src/engine/core-modules/serverless/drivers/enums/runtime.enum';

export interface LambdaDriverOptions extends LambdaClientConfig {
  fileStorageService: FileStorageService;
  region: string;
  role: string;
}

const MAX_WAIT_TIME = 20;

export class LambdaDriver implements ServerlessDriver {
  private readonly lambdaClient: Lambda;
  private readonly lambdaRole: string;
  private readonly fileStorageService: FileStorageService;

  constructor(options: LambdaDriverOptions) {
    const { region, role, ...lambdaOptions } = options;

    this.lambdaClient = new Lambda({ ...lambdaOptions, region });
    this.lambdaRole = role;
    this.fileStorageService = options.fileStorageService;
  }

  private async waitFunctionUpdates(
    serverlessFunctionId: string,
    maxWaitTime: number,
  ) {
    const waitParams = { FunctionName: serverlessFunctionId };

    await waitUntilFunctionUpdatedV2(
      { client: this.lambdaClient, maxWaitTime },
      waitParams,
    );
  }

  private async createLayerIfNotExists(version: number): Promise<string> {
    const listLayerParams: ListLayerVersionsCommandInput = {
      LayerName: COMMON_LAYER_NAME,
      MaxItems: 1,
    };
    const listLayerCommand = new ListLayerVersionsCommand(listLayerParams);
    const listLayerResult = await this.lambdaClient.send(listLayerCommand);

    if (
      isDefined(listLayerResult.LayerVersions) &&
      listLayerResult.LayerVersions.length > 0 &&
      listLayerResult.LayerVersions?.[0].Description === `${version}` &&
      isDefined(listLayerResult.LayerVersions[0].LayerVersionArn)
    ) {
      return listLayerResult.LayerVersions[0].LayerVersionArn;
    }

    const lambdaBuildDirectoryManager = new LambdaBuildDirectoryManager();
    const { sourceTemporaryDir, lambdaZipPath } =
      await lambdaBuildDirectoryManager.init();

    const nodeDependenciesFolder = join(
      sourceTemporaryDir,
      NODE_LAYER_SUBFOLDER,
    );

    await copyAndBuildDependencies(nodeDependenciesFolder);

    await createZipFile(sourceTemporaryDir, lambdaZipPath);

    const params: PublishLayerVersionCommandInput = {
      LayerName: COMMON_LAYER_NAME,
      Content: {
        ZipFile: await fs.readFile(lambdaZipPath),
      },
      CompatibleRuntimes: [ServerlessFunctionRuntime.NODE18],
      Description: `${version}`,
    };

    const command = new PublishLayerVersionCommand(params);

    const result = await this.lambdaClient.send(command);

    await lambdaBuildDirectoryManager.clean();

    if (!isDefined(result.LayerVersionArn)) {
      throw new Error('new layer version arn si undefined');
    }

    return result.LayerVersionArn;
  }

  private async checkFunctionExists(functionName: string): Promise<boolean> {
    try {
      const getFunctionCommand = new GetFunctionCommand({
        FunctionName: functionName,
      });

      await this.lambdaClient.send(getFunctionCommand);

      return true;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return false;
      }
      throw error;
    }
  }

  async delete(serverlessFunctionName: string) {
    const functionExists = await this.checkFunctionExists(
      serverlessFunctionName,
    );

    if (functionExists) {
      const deleteFunctionCommand = new DeleteFunctionCommand({
        FunctionName: serverlessFunctionName,
      });

      await this.lambdaClient.send(deleteFunctionCommand);
    }
  }

  private getInMemoryServerlessFunctionFolderPath = (
    serverlessFunctionId: string,
    version: string,
  ) => {
    return join(SERVERLESS_TMPDIR_FOLDER, serverlessFunctionId, version);
  };

  async build({
    workspaceId,
    serverlessFunctionId,
    serverlessFunctionVersion,
    layerVersion,
    runtime,
  }: {
    workspaceId: string;
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    layerVersion: number | null;
    runtime: Runtime;
  }) {
    if (serverlessFunctionVersion === 'latest') {
      throw new Error('cannot support "latest" version');
    }

    const inMemoryServerlessFunctionFolderPath =
      this.getInMemoryServerlessFunctionFolderPath(
        serverlessFunctionId,
        serverlessFunctionVersion,
      );

    const folderPath = getServerlessFolder({
      workspaceId,
      serverlessFunctionId: serverlessFunctionId,
      serverlessFunctionVersion,
    });

    await this.fileStorageService.download({
      from: { folderPath },
      to: { folderPath: inMemoryServerlessFunctionFolderPath },
    });

    compileTypescript(inMemoryServerlessFunctionFolderPath);

    const lambdaZipPath = join(
      inMemoryServerlessFunctionFolderPath,
      'lambda.zip',
    );

    await createZipFile(
      join(inMemoryServerlessFunctionFolderPath, OUTDIR_FOLDER),
      lambdaZipPath,
    );

    const envFileContent = await fs.readFile(
      join(inMemoryServerlessFunctionFolderPath, ENV_FILE_NAME),
    );

    const envVariables = dotenv.parse(envFileContent);

    const functionExists = await this.checkFunctionExists(serverlessFunctionId);

    if (!functionExists) {
      const layers: string[] = [];

      if (layerVersion) {
        layers.push(await this.createLayerIfNotExists(layerVersion));
      }

      const params: CreateFunctionCommandInput = {
        Code: {
          ZipFile: await fs.readFile(lambdaZipPath),
        },
        FunctionName: serverlessFunctionId,
        Handler: 'src/index.handler',
        Layers: layers,
        Environment: {
          Variables: envVariables,
        },
        Role: this.lambdaRole,
        Runtime: runtime,
        Description: 'Lambda function to run user script',
        Timeout: 900,
      };

      const command = new CreateFunctionCommand(params);

      await this.lambdaClient.send(command);
    } else {
      const updateCodeParams: UpdateFunctionCodeCommandInput = {
        ZipFile: await fs.readFile(lambdaZipPath),
        FunctionName: serverlessFunctionId,
      };

      const updateCodeCommand = new UpdateFunctionCodeCommand(updateCodeParams);

      await this.lambdaClient.send(updateCodeCommand);

      const updateConfigurationParams: UpdateFunctionConfigurationCommandInput =
        {
          Environment: {
            Variables: envVariables,
          },
          FunctionName: serverlessFunctionId,
        };

      const updateConfigurationCommand = new UpdateFunctionConfigurationCommand(
        updateConfigurationParams,
      );

      await this.waitFunctionUpdates(serverlessFunctionId, MAX_WAIT_TIME);

      await this.lambdaClient.send(updateConfigurationCommand);
    }

    await this.waitFunctionUpdates(serverlessFunctionId, MAX_WAIT_TIME);
  }

  async publish({
    workspaceId,
    serverlessFunctionId,
    layerVersion,
    runtime,
  }: {
    workspaceId: string;
    serverlessFunctionId: string;
    layerVersion: number | null;
    runtime: Runtime;
  }) {
    await this.build({
      workspaceId,
      serverlessFunctionId,
      serverlessFunctionVersion: 'draft',
      layerVersion,
      runtime,
    });

    const params: PublishVersionCommandInput = {
      FunctionName: serverlessFunctionId,
    };

    const command = new PublishVersionCommand(params);

    const result = await this.lambdaClient.send(command);
    const newVersion = result.Version;

    if (!newVersion) {
      throw new Error('New published version is undefined');
    }

    const draftFolderPath = getServerlessFolder({
      workspaceId,
      serverlessFunctionId,
      serverlessFunctionVersion: 'draft',
    });
    const newFolderPath = getServerlessFolder({
      workspaceId,
      serverlessFunctionId,
      serverlessFunctionVersion: newVersion,
    });

    await this.fileStorageService.copy({
      from: { folderPath: draftFolderPath },
      to: { folderPath: newFolderPath },
    });

    return newVersion;
  }

  async execute({
    serverlessFunctionId,
    serverlessFunctionVersion,
    payload,
  }: {
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    payload: object;
  }): Promise<ServerlessExecuteResult> {
    if (serverlessFunctionVersion === 'latest') {
      throw new Error('cannot support "latest" version');
    }

    const functionName =
      serverlessFunctionVersion === 'draft'
        ? serverlessFunctionId
        : `${serverlessFunctionId}:${serverlessFunctionVersion}`;

    await this.waitFunctionUpdates(serverlessFunctionId, MAX_WAIT_TIME);

    const startTime = Date.now();
    const params: InvokeCommandInput = {
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
    };

    const command = new InvokeCommand(params);

    try {
      const result = await this.lambdaClient.send(command);

      const parsedResult = result.Payload
        ? JSON.parse(result.Payload.transformToString())
        : {};

      const duration = Date.now() - startTime;

      if (result.FunctionError) {
        return {
          data: null,
          duration,
          status: ServerlessFunctionExecutionStatus.ERROR,
          error: parsedResult,
        };
      }

      return {
        data: parsedResult,
        duration,
        status: ServerlessFunctionExecutionStatus.SUCCESS,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new ServerlessFunctionException(
          `Function Version '${serverlessFunctionVersion}' does not exist`,
          ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
        );
      }
      throw error;
    }
  }
}
