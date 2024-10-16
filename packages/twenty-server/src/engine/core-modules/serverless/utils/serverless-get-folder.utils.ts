import { join } from 'path';

import { FileFolder } from 'src/engine/core-modules/file/interfaces/file-folder.interface';

export const getServerlessFolder = ({
  workspaceId,
  serverlessFunctionId,
  serverlessFunctionVersion,
}: {
  workspaceId: string;
  serverlessFunctionId: string;
  serverlessFunctionVersion?: string | null;
}) => {
  if (serverlessFunctionVersion === 'latest') {
    throw new Error('cannot support "latest" version');
  }

  return join(
    'workspace-' + workspaceId,
    FileFolder.ServerlessFunction,
    serverlessFunctionId,
    serverlessFunctionVersion || '',
  );
};
