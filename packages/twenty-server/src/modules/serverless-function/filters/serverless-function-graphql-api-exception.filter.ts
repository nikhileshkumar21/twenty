import { Catch, ExceptionFilter } from '@nestjs/common';

import {
  ServerlessFunctionException,
  ServerlessFunctionExceptionCode,
} from 'src/modules/serverless/exceptions/serverless-function.exception';
import {
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

@Catch(ServerlessFunctionException)
export class ServerlessFunctionGraphqlApiExceptionFilter
  implements ExceptionFilter
{
  catch(exception: ServerlessFunctionException) {
    switch (exception.code) {
      case ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND:
      case ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_VERSION_NOT_FOUND:
        throw new NotFoundError(exception.message);
      case ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_ALREADY_EXIST:
        throw new ConflictError(exception.message);
      case ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_READY:
      case ServerlessFunctionExceptionCode.FEATURE_FLAG_INVALID:
        throw new ForbiddenError(exception.message);
      default:
        throw new InternalServerError(exception.message);
    }
  }
}
