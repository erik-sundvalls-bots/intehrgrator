export {
  blocklyJsonDocument,
  blocklyJsonDocumentForRoot,
  projectBlocklyState,
  slotAttributeFromInputName,
  specAnchorForBlocks,
  type BlocklyJsonDocument,
  type SpecEditFieldName,
  type SpecEditKind,
  type SpecEditableField,
  type SpecLine,
  type SpecLineKind,
  type SpecProjection,
} from "./project.ts";

export {
  blocksEligibleForBulkMark,
  deleteMarkedSpecBlocks,
  isOptionalUnmappedScaffoldBlock,
  pruneCheckedBlockIds,
  specRowBlockIdsEligibleForBulkMark,
  topLevelBlockIds,
} from "./bulk_actions.ts";

export {
  createMappingSpecEditor,
  mappingSpecDocumentText,
  setMappingSpecFromBlockly,
  setMappingSpecChrome,
  scrollMappingSpecToBlock,
  specRangeMatchesSearch,
  specRangeIsCurrentSearchHit,
  type MappingSpecEditorOptions,
  type SpecFieldEditHandler,
  type SpecBlockSelectHandler,
  type SpecBlockCheckHandler,
  type SpecChrome,
} from "./editor.ts";

export { specOverviewTickTopPx, specWarningMarkers, type SpecWarningMarker } from "./overview.ts";
