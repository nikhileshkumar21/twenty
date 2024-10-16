import { fork } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

import dotenv from 'dotenv';

import {
  ServerlessDriver,
  ServerlessExecuteError,
  ServerlessExecuteResult,
} from 'src/engine/core-modules/serverless/drivers/interfaces/serverless-driver.interface';

import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { getServerlessFolder } from 'src/engine/core-modules/serverless/utils/serverless-get-folder.utils';
import { ServerlessFunctionExecutionStatus } from 'src/modules/serverless-function/dtos/serverless-function-execution-result.dto';
import { COMMON_LAYER_NAME } from 'src/engine/core-modules/serverless/drivers/constants/common-layer-name';
import { copyAndBuildDependencies } from 'src/engine/core-modules/serverless/drivers/utils/copy-and-build-dependencies';
import { SERVERLESS_TMPDIR_FOLDER } from 'src/engine/core-modules/serverless/drivers/constants/serverless-tmpdir-folder';
import { compileTypescript } from 'src/engine/core-modules/serverless/drivers/utils/compile-typescript';
import { OUTDIR_FOLDER } from 'src/engine/core-modules/serverless/drivers/constants/outdir-folder';
import { ENV_FILE_NAME } from 'src/engine/core-modules/serverless/drivers/constants/env-file-name';

const LISTENER_FILE_NAME = 'listener.js';

export interface LocalDriverOptions {
  fileStorageService: FileStorageService;
}

export class LocalDriver implements ServerlessDriver {
  private readonly fileStorageService: FileStorageService;

  constructor(options: LocalDriverOptions) {
    this.fileStorageService = options.fileStorageService;
  }

  private getInMemoryServerlessFunctionFolderPath = (
    serverlessFunctionId: string,
    version: string,
  ) => {
    return join(SERVERLESS_TMPDIR_FOLDER, serverlessFunctionId, version);
  };

  private getInMemoryLayerFolderPath = (version: number) => {
    return join(SERVERLESS_TMPDIR_FOLDER, COMMON_LAYER_NAME, `${version}`);
  };

  private async createLayerIfNotExists(version: number) {
    const inMemoryLastVersionLayerFolderPath =
      this.getInMemoryLayerFolderPath(version);

    try {
      await fs.access(inMemoryLastVersionLayerFolderPath);
    } catch (e) {
      await copyAndBuildDependencies(inMemoryLastVersionLayerFolderPath);
    }
  }

  async delete() {}

  async build({
    workspaceId,
    serverlessFunctionId,
    serverlessFunctionVersion,
    layerVersion,
  }: {
    workspaceId: string;
    serverlessFunctionId: string;
    serverlessFunctionVersion: string;
    layerVersion: number | null;
  }) {
    if (serverlessFunctionVersion === 'latest') {
      throw new Error('cannot support "latest" version');
    }

    if (layerVersion) {
      await this.createLayerIfNotExists(layerVersion);
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

    const envFileContent = await fs.readFile(
      join(inMemoryServerlessFunctionFolderPath, ENV_FILE_NAME),
    );

    const envVariables = dotenv.parse(envFileContent);

    const listener = `
    const index_1 = require("./src/index");
    
    process.env = ${JSON.stringify(envVariables)}
    
    process.on('message', async (message) => {
      const { event, context } = message;
      try {
        const result = await index_1.handler(event, context);
        process.send(result);
      } catch (error) {
        process.send({
          errorType: error.name,
          errorMessage: error.message,
          stackTrace: error.stack.split('\\n').filter((line) => line.trim() !== ''),
        });
      }
    });
    `;

    await fs.writeFile(
      join(
        inMemoryServerlessFunctionFolderPath,
        OUTDIR_FOLDER,
        LISTENER_FILE_NAME,
      ),
      listener,
    );

    if (layerVersion) {
      try {
        await fs.symlink(
          join(this.getInMemoryLayerFolderPath(layerVersion), 'node_modules'),
          join(
            inMemoryServerlessFunctionFolderPath,
            OUTDIR_FOLDER,
            'node_modules',
          ),
          'dir',
        );
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }
    }
  }

  async publish({
    workspaceId,
    serverlessFunctionId,
    currentServerlessFunctionVersion,
    layerVersion,
  }: {
    workspaceId: string;
    serverlessFunctionId: string;
    currentServerlessFunctionVersion: string | null;
    layerVersion: number | null;
  }) {
    const newVersion = currentServerlessFunctionVersion
      ? `${parseInt(currentServerlessFunctionVersion, 10) + 1}`
      : '1';

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

    await this.build({
      workspaceId,
      serverlessFunctionId,
      serverlessFunctionVersion: newVersion,
      layerVersion,
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

    const startTime = Date.now();

    const listenerFile = join(
      this.getInMemoryServerlessFunctionFolderPath(
        serverlessFunctionId,
        serverlessFunctionVersion,
      ),
      OUTDIR_FOLDER,
      LISTENER_FILE_NAME,
    );

    try {
      return await new Promise((resolve, reject) => {
        const child = fork(listenerFile, { silent: true });

        child.on('message', (message: object | ServerlessExecuteError) => {
          const duration = Date.now() - startTime;

          if ('errorType' in message) {
            resolve({
              data: null,
              duration,
              error: message,
              status: ServerlessFunctionExecutionStatus.ERROR,
            });
          } else {
            resolve({
              data: message,
              duration,
              status: ServerlessFunctionExecutionStatus.SUCCESS,
            });
          }
          child.kill();
        });

        child.stderr?.on('data', (data) => {
          const stackTrace = data
            .toString()
            .split('\n')
            .filter((line: string) => line.trim() !== '');
          const errorTrace = stackTrace.filter((line: string) =>
            line.includes('Error: '),
          )?.[0];

          let errorType = 'Unknown';
          let errorMessage = '';

          if (errorTrace) {
            errorType = errorTrace.split(':')[0];
            errorMessage = errorTrace.split(': ')[1];
          }
          const duration = Date.now() - startTime;

          resolve({
            data: null,
            duration,
            status: ServerlessFunctionExecutionStatus.ERROR,
            error: {
              errorType,
              errorMessage,
              stackTrace: stackTrace,
            },
          });
          child.kill();
        });

        child.on('error', (error) => {
          reject(error);
          child.kill();
        });

        child.on('exit', (code) => {
          if (code && code !== 0) {
            reject(new Error(`Child process exited with code ${code}`));
          }
        });

        child.send({ event: payload });
      });
    } catch (error) {
      return {
        data: null,
        duration: Date.now() - startTime,
        error: {
          errorType: 'UnhandledError',
          errorMessage: error.message || 'Unknown error',
          stackTrace: error.stack ? error.stack.split('\n') : [],
        },
        status: ServerlessFunctionExecutionStatus.ERROR,
      };
    }
  }
}
