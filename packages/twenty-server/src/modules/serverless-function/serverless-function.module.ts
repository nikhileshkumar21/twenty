import { Module } from '@nestjs/common';

import { ServerlessFunctionWorkspaceService } from 'src/modules/serverless-function/workspace-services/serverless-function.workspace-service';
import { ThrottlerModule } from 'src/engine/core-modules/throttler/throttler.module';

@Module({
  imports: [ThrottlerModule],
  providers: [ServerlessFunctionWorkspaceService],
  exports: [ServerlessFunctionWorkspaceService],
})
export class ServerlessFunctionModule {}
