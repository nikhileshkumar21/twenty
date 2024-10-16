import { UseFilters, UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import graphqlTypeJson from 'graphql-type-json';
import { Repository } from 'typeorm';

import { FeatureFlagKey } from 'src/engine/core-modules/feature-flag/enums/feature-flag-key.enum';
import { FeatureFlagEntity } from 'src/engine/core-modules/feature-flag/feature-flag.entity';
import { Workspace } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { CreateServerlessFunctionInput } from 'src/modules/serverless-function/dtos/create-serverless-function.input';
import { DeleteServerlessFunctionInput } from 'src/modules/serverless-function/dtos/delete-serverless-function.input';
import { ExecuteServerlessFunctionInput } from 'src/modules/serverless-function/dtos/execute-serverless-function.input';
import { GetServerlessFunctionSourceCodeInput } from 'src/modules/serverless-function/dtos/get-serverless-function-source-code.input';
import { PublishServerlessFunctionInput } from 'src/modules/serverless-function/dtos/publish-serverless-function.input';
import { ServerlessFunctionExecutionResultDTO } from 'src/modules/serverless-function/dtos/serverless-function-execution-result.dto';
import { ServerlessFunctionDTO } from 'src/modules/serverless-function/dtos/serverless-function.dto';
import { UpdateServerlessFunctionInput } from 'src/modules/serverless-function/dtos/update-serverless-function.input';
import {
  ServerlessFunctionException,
  ServerlessFunctionExceptionCode,
} from 'src/modules/serverless-function/exceptions/serverless-function.exception';
import { ServerlessFunctionGraphqlApiExceptionFilter } from 'src/modules/serverless-function/filters/serverless-function-graphql-api-exception.filter';
import { ServerlessFunctionWorkspaceService } from 'src/modules/serverless-function/workspace-services/serverless-function.workspace-service';

@Resolver()
@UseGuards(WorkspaceAuthGuard)
@UseFilters(ServerlessFunctionGraphqlApiExceptionFilter)
export class ServerlessFunctionResolver {
  constructor(
    private readonly serverlessFunctionWorkspaceService: ServerlessFunctionWorkspaceService,
    @InjectRepository(FeatureFlagEntity, 'core')
    private readonly featureFlagRepository: Repository<FeatureFlagEntity>,
  ) {}

  async checkFeatureFlag(workspaceId: string) {
    const isFunctionSettingsEnabled =
      await this.featureFlagRepository.findOneBy({
        workspaceId,
        key: FeatureFlagKey.IsFunctionSettingsEnabled,
        value: true,
      });

    if (!isFunctionSettingsEnabled) {
      throw new ServerlessFunctionException(
        `IS_FUNCTION_SETTINGS_ENABLED feature flag is not set to true for this workspace`,
        ServerlessFunctionExceptionCode.FEATURE_FLAG_INVALID,
      );
    }
  }

  @Query(() => graphqlTypeJson)
  async getAvailablePackages(@AuthWorkspace() { id: workspaceId }: Workspace) {
    await this.checkFeatureFlag(workspaceId);

    return await this.serverlessFunctionWorkspaceService.getAvailablePackages();
  }

  @Query(() => graphqlTypeJson, { nullable: true })
  async getServerlessFunctionSourceCode(
    @Args('input') input: GetServerlessFunctionSourceCodeInput,
    @AuthWorkspace() { id: workspaceId }: Workspace,
  ) {
    await this.checkFeatureFlag(workspaceId);

    return await this.serverlessFunctionWorkspaceService.getServerlessFunctionSourceCode(
      workspaceId,
      input.id,
      input.version,
    );
  }

  @Mutation(() => ServerlessFunctionDTO)
  async deleteOneServerlessFunction(
    @Args('input') input: DeleteServerlessFunctionInput,
    @AuthWorkspace() { id: workspaceId }: Workspace,
  ) {
    await this.checkFeatureFlag(workspaceId);

    return await this.serverlessFunctionWorkspaceService.deleteOneServerlessFunction(
      input.id,
      workspaceId,
    );
  }

  @Mutation(() => ServerlessFunctionDTO)
  async updateOneServerlessFunction(
    @Args('input')
    input: UpdateServerlessFunctionInput,
    @AuthWorkspace() { id: workspaceId }: Workspace,
  ) {
    await this.checkFeatureFlag(workspaceId);

    return await this.serverlessFunctionWorkspaceService.updateOneServerlessFunction(
      input,
      workspaceId,
    );
  }

  @Mutation(() => ServerlessFunctionDTO)
  async createOneServerlessFunction(
    @Args('input')
    input: CreateServerlessFunctionInput,
    @AuthWorkspace() { id: workspaceId }: Workspace,
  ) {
    await this.checkFeatureFlag(workspaceId);

    return await this.serverlessFunctionWorkspaceService.createOneServerlessFunction(
      {
        name: input.name,
        description: input.description,
      },
      workspaceId,
    );
  }

  @Mutation(() => ServerlessFunctionExecutionResultDTO)
  async executeOneServerlessFunction(
    @Args('input') input: ExecuteServerlessFunctionInput,
    @AuthWorkspace() { id: workspaceId }: Workspace,
  ) {
    await this.checkFeatureFlag(workspaceId);
    const { id, payload, version } = input;

    return await this.serverlessFunctionWorkspaceService.executeOneServerlessFunction(
      id,
      workspaceId,
      payload,
      version,
    );
  }

  @Mutation(() => ServerlessFunctionDTO)
  async publishServerlessFunction(
    @Args('input') input: PublishServerlessFunctionInput,
    @AuthWorkspace() { id: workspaceId }: Workspace,
  ) {
    await this.checkFeatureFlag(workspaceId);
    const { id } = input;

    return await this.serverlessFunctionWorkspaceService.publishOneServerlessFunction(
      id,
      workspaceId,
    );
  }
}
