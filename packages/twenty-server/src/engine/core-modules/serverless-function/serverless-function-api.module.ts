import { Module } from '@nestjs/common';

import { ServerlessFunctionModule } from 'src/modules/serverless-function/serverless-function.module';
import { ServerlessFunctionResolver } from 'src/engine/core-modules/serverless-function/serverless-function.resolver';

@Module({
  imports: [ServerlessFunctionModule],
  providers: [ServerlessFunctionResolver],
})
export class ServerlessFunctionApiModule {}
