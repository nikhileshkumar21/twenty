import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { basename, dirname, join } from 'path';

import { Repository } from 'typeorm';
import deepEqual from 'deep-equal';

import { FileStorageExceptionCode } from 'src/engine/core-modules/file-storage/interfaces/file-storage-exception';
import { ServerlessExecuteResult } from 'src/engine/core-modules/serverless/drivers/interfaces/serverless-driver.interface';

import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { ServerlessService } from 'src/engine/core-modules/serverless/serverless.service';
import {
  ServerlessFunctionEntity,
  ServerlessFunctionSyncStatus,
} from 'src/engine/metadata-modules/serverless-function/serverless-function.entity';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';
import { EnvironmentService } from 'src/engine/core-modules/environment/environment.service';
import {
  ServerlessFunctionException,
  ServerlessFunctionExceptionCode,
} from 'src/modules/serverless/exceptions/serverless-function.exception';
import { getServerlessFolder } from 'src/engine/core-modules/serverless/utils/serverless-get-folder.utils';
import { INDEX_FILE_NAME } from 'src/engine/core-modules/serverless/drivers/constants/index-file-name';
import { ENV_FILE_NAME } from 'src/engine/core-modules/serverless/drivers/constants/env-file-name';
import { readFileContent } from 'src/engine/core-modules/file-storage/utils/read-file-content';
import { isDefined } from 'src/utils/is-defined';
import { UpdateServerlessFunctionInput } from 'src/modules/serverless/dtos/update-serverless-function.input';
import { getLastLayerDependencies } from 'src/engine/core-modules/serverless/drivers/utils/get-last-layer-dependencies';
import { CreateServerlessFunctionInput } from 'src/modules/serverless/dtos/create-serverless-function.input';
import { LAST_LAYER_VERSION } from 'src/engine/core-modules/serverless/drivers/layers/last-layer-version';
import { getBaseTypescriptProjectFiles } from 'src/engine/core-modules/serverless/drivers/utils/get-base-typescript-project-files';
import { TwentyORMManager } from 'src/engine/twenty-orm/twenty-orm.manager';
import { ServerlessFunctionWorkspaceEntity } from 'src/modules/serverless/standard-objects/serverless-function.workspace-entity';

@Injectable()
export class ServerlessFunctionWorkspaceService {
  constructor(
    private readonly twentyORMManager: TwentyORMManager,
    private readonly fileStorageService: FileStorageService,
    private readonly serverlessService: ServerlessService,
    @InjectRepository(ServerlessFunctionEntity, 'metadata')
    private readonly serverlessFunctionRepository: Repository<ServerlessFunctionEntity>,
    private readonly throttlerService: ThrottlerService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async getServerlessFunctionSourceCode(
    workspaceId: string,
    id: string,
    version: string,
  ): Promise<{ [filePath: string]: string } | undefined> {
    const serverlessFunctionRepository =
      await this.twentyORMManager.getRepository<ServerlessFunctionWorkspaceEntity>(
        'serverlessFunction',
      );
    const serverlessFunction = await serverlessFunctionRepository.findOne({
      where: {
        id,
      },
    });

    if (!serverlessFunction) {
      throw new ServerlessFunctionException(
        `Function does not exist`,
        ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
      );
    }

    try {
      const folderPath = getServerlessFolder({
        workspaceId,
        serverlessFunctionId: serverlessFunction.id,
        serverlessFunctionVersion:
          version === 'latest' ? serverlessFunction.latestVersion : version,
      });

      const indexFileStream = await this.fileStorageService.read({
        folderPath: join(folderPath, 'src'),
        filename: INDEX_FILE_NAME,
      });

      const envFileStream = await this.fileStorageService.read({
        folderPath: folderPath,
        filename: ENV_FILE_NAME,
      });

      return {
        '.env': await readFileContent(envFileStream),
        'src/index.ts': await readFileContent(indexFileStream),
      };
    } catch (error) {
      if (error.code === FileStorageExceptionCode.FILE_NOT_FOUND) {
        return;
      }
      throw error;
    }
  }

  async executeOneServerlessFunction(
    id: string,
    workspaceId: string,
    payload: object,
    version = 'latest',
  ): Promise<ServerlessExecuteResult> {
    await this.throttleExecution(workspaceId);
    const serverlessFunctionRepository =
      await this.twentyORMManager.getRepository<ServerlessFunctionWorkspaceEntity>(
        'serverlessFunction',
      );

    const functionToExecute = await serverlessFunctionRepository.findOneBy({
      id,
    });

    if (!functionToExecute) {
      throw new ServerlessFunctionException(
        `Function does not exist`,
        ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
      );
    }

    const computedVersion =
      (version === 'latest' ? functionToExecute.latestVersion : version) ||
      'draft';

    return this.serverlessService.execute({
      serverlessFunctionId: functionToExecute.id,
      serverlessFunctionVersion: computedVersion,
      payload,
    });
  }

  async publishOneServerlessFunction(id: string, workspaceId: string) {
    const serverlessFunctionRepository =
      await this.twentyORMManager.getRepository<ServerlessFunctionWorkspaceEntity>(
        'serverlessFunction',
      );
    const existingServerlessFunction =
      await serverlessFunctionRepository.findOneBy({ id });

    if (!existingServerlessFunction) {
      throw new ServerlessFunctionException(
        `Function does not exist`,
        ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
      );
    }

    if (isDefined(existingServerlessFunction.latestVersion)) {
      const latestCode = await this.getServerlessFunctionSourceCode(
        workspaceId,
        id,
        'latest',
      );
      const draftCode = await this.getServerlessFunctionSourceCode(
        workspaceId,
        id,
        'draft',
      );

      if (deepEqual(latestCode, draftCode)) {
        throw new Error(
          'Cannot publish a new version when code has not changed',
        );
      }
    }

    const newVersion = await this.serverlessService.publish({
      workspaceId,
      serverlessFunctionId: existingServerlessFunction.id,
      currentServerlessFunctionVersion:
        existingServerlessFunction.latestVersion,
      layerVersion: existingServerlessFunction.layerVersion,
      runtime: existingServerlessFunction.runtime,
    });

    await serverlessFunctionRepository.update(existingServerlessFunction.id, {
      latestVersion: newVersion,
    });

    return await serverlessFunctionRepository.findOneBy({
      id: existingServerlessFunction.id,
    });
  }

  async deleteOneServerlessFunction(id: string, workspaceId: string) {
    const serverlessFunctionRepository =
      await this.twentyORMManager.getRepository<ServerlessFunctionWorkspaceEntity>(
        'serverlessFunction',
      );
    const existingServerlessFunction =
      await serverlessFunctionRepository.findOneBy({ id });

    if (!existingServerlessFunction) {
      throw new ServerlessFunctionException(
        `Function does not exist`,
        ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
      );
    }

    await serverlessFunctionRepository.delete(id);

    await this.serverlessService.delete(id);

    await this.fileStorageService.delete({
      folderPath: getServerlessFolder({
        workspaceId,
        serverlessFunctionId: existingServerlessFunction.id,
      }),
    });

    return existingServerlessFunction;
  }

  async updateOneServerlessFunction(
    serverlessFunctionInput: UpdateServerlessFunctionInput,
    workspaceId: string,
  ) {
    const serverlessFunctionRepository =
      await this.twentyORMManager.getRepository<ServerlessFunctionWorkspaceEntity>(
        'serverlessFunction',
      );
    const existingServerlessFunction =
      await serverlessFunctionRepository.findOneBy({
        id: serverlessFunctionInput.id,
      });

    if (!existingServerlessFunction) {
      throw new ServerlessFunctionException(
        `Function does not exist`,
        ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
      );
    }

    await serverlessFunctionRepository.update(existingServerlessFunction.id, {
      name: serverlessFunctionInput.name,
      description: serverlessFunctionInput.description,
      syncStatus: ServerlessFunctionSyncStatus.NOT_READY,
    });

    const fileFolder = getServerlessFolder({
      workspaceId,
      serverlessFunctionId: existingServerlessFunction.id,
      serverlessFunctionVersion: 'draft',
    });

    for (const key of Object.keys(serverlessFunctionInput.code)) {
      await this.fileStorageService.write({
        file: serverlessFunctionInput.code[key],
        name: basename(key),
        mimeType: undefined,
        folder: join(fileFolder, dirname(key)),
      });
    }

    await this.serverlessService.build({
      workspaceId,
      serverlessFunctionId: existingServerlessFunction.id,
      serverlessFunctionVersion: 'draft',
      layerVersion: existingServerlessFunction.layerVersion,
      runtime: existingServerlessFunction.runtime,
    });

    await serverlessFunctionRepository.update(existingServerlessFunction.id, {
      syncStatus: ServerlessFunctionSyncStatus.READY,
    });

    return await serverlessFunctionRepository.findOneBy({
      id: existingServerlessFunction.id,
    });
  }

  async getAvailablePackages() {
    const { packageJson, yarnLock } = await getLastLayerDependencies();

    const packageVersionRegex = /^"([^@]+)@.*?":\n\s+version: (.+)$/gm;
    const versions: Record<string, string> = {};

    let match: RegExpExecArray | null;

    while ((match = packageVersionRegex.exec(yarnLock)) !== null) {
      const packageName = match[1].split('@', 1)[0];
      const version = match[2];

      if (packageJson.dependencies[packageName]) {
        versions[packageName] = version;
      }
    }

    return versions;
  }

  async createOneServerlessFunction(
    serverlessFunctionInput: CreateServerlessFunctionInput,
    workspaceId: string,
  ) {
    const serverlessFunctionRepository =
      await this.twentyORMManager.getRepository<ServerlessFunctionWorkspaceEntity>(
        'serverlessFunction',
      );

    const serverlessFunctionToCreate =
      await serverlessFunctionRepository.create({
        ...serverlessFunctionInput,
        layerVersion: LAST_LAYER_VERSION,
      });

    const serverlessFunction = await serverlessFunctionRepository.save(
      serverlessFunctionToCreate,
    );

    const draftFileFolder = getServerlessFolder({
      workspaceId,
      serverlessFunctionId: serverlessFunction.id,
      serverlessFunctionVersion: 'draft',
    });

    for (const file of await getBaseTypescriptProjectFiles) {
      await this.fileStorageService.write({
        file: file.content,
        name: file.name,
        mimeType: undefined,
        folder: join(draftFileFolder, file.path),
      });
    }

    await this.serverlessService.build({
      workspaceId,
      serverlessFunctionId: serverlessFunction.id,
      serverlessFunctionVersion: 'draft',
      layerVersion: serverlessFunction.layerVersion,
      runtime: serverlessFunction.runtime,
    });

    return serverlessFunction;
  }

  private async throttleExecution(workspaceId: string) {
    try {
      await this.throttlerService.throttle(
        `${workspaceId}-serverless-function-execution`,
        this.environmentService.get('SERVERLESS_FUNCTION_EXEC_THROTTLE_LIMIT'),
        this.environmentService.get('SERVERLESS_FUNCTION_EXEC_THROTTLE_TTL'),
      );
    } catch (error) {
      throw new ServerlessFunctionException(
        'Serverless function execution rate limit exceeded',
        ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_EXECUTION_LIMIT_REACHED,
      );
    }
  }
}
