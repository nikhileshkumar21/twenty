import { WorkspaceEntity } from 'src/engine/twenty-orm/decorators/workspace-entity.decorator';
import { STANDARD_OBJECT_IDS } from 'src/engine/workspace-manager/workspace-sync-metadata/constants/standard-object-ids';
import { SERVERLESS_FUNCTION_STANDARD_FIELD_IDS } from 'src/engine/workspace-manager/workspace-sync-metadata/constants/standard-field-ids';
import { WorkspaceGate } from 'src/engine/twenty-orm/decorators/workspace-gate.decorator';
import { FeatureFlagKey } from 'src/engine/core-modules/feature-flag/enums/feature-flag-key.enum';
import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { WorkspaceField } from 'src/engine/twenty-orm/decorators/workspace-field.decorator';
import { FieldMetadataType } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { WorkspaceIsNullable } from 'src/engine/twenty-orm/decorators/workspace-is-nullable.decorator';
import { Runtime } from 'src/engine/core-modules/serverless/drivers/enums/runtime.enum';

export enum ServerlessFunctionSyncStatus {
  NOT_READY = 'NOT_READY',
  READY = 'READY',
}

@WorkspaceEntity({
  standardId: STANDARD_OBJECT_IDS.serverlessFunction,
  namePlural: 'serverlessFunctions',
  labelSingular: 'Serverless Function',
  labelPlural: 'Serverless Functions',
  description: 'A serverless function',
  icon: 'IconCode',
  labelIdentifierStandardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.name,
})
@WorkspaceGate({
  featureFlag: FeatureFlagKey.IsFunctionSettingsEnabled,
})
export class ServerlessFunctionWorkspaceEntity extends BaseWorkspaceEntity {
  @WorkspaceField({
    standardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.name,
    type: FieldMetadataType.TEXT,
    label: 'Name',
    description: 'The serverless function name',
    icon: 'IconCode',
  })
  name: string;

  @WorkspaceField({
    standardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.description,
    type: FieldMetadataType.TEXT,
    label: 'Description',
    description: 'The serverless function description',
  })
  @WorkspaceIsNullable()
  description: string | null;

  @WorkspaceField({
    standardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.latestVersion,
    type: FieldMetadataType.TEXT,
    label: 'Latest Version',
    description: 'The serverless function latest version',
    icon: 'IconVersions',
  })
  @WorkspaceIsNullable()
  latestVersion: string | null;

  @WorkspaceField({
    standardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.runtime,
    type: FieldMetadataType.TEXT,
    label: 'Runtime',
    description: 'The serverless function runtime',
    icon: 'IconRobot',
    defaultValue: Runtime.NODE18,
  })
  runtime: Runtime;

  @WorkspaceField({
    standardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.layerVersion,
    type: FieldMetadataType.NUMBER,
    label: 'Layer Version',
    description: 'The serverless function layer version',
    icon: 'IconVersions',
  })
  @WorkspaceIsNullable()
  layerVersion: number | null;

  @WorkspaceField({
    standardId: SERVERLESS_FUNCTION_STANDARD_FIELD_IDS.syncStatus,
    type: FieldMetadataType.SELECT,
    label: 'Sync Status',
    description: 'The serverless function sync status',
    icon: 'IconStatusChange',
    options: [
      {
        value: ServerlessFunctionSyncStatus.READY,
        label: 'Ready',
        position: 1,
        color: 'green',
      },
      {
        value: ServerlessFunctionSyncStatus.NOT_READY,
        label: 'Not Ready',
        position: 2,
        color: 'yellow',
      },
    ],
  })
  syncStatus: ServerlessFunctionSyncStatus;
}
