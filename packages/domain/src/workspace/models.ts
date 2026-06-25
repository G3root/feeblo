import { WorkspaceId } from "@feeblo/utils/effect-ids";
import * as M from "../model-utils";

class Model extends M.Class<Model>("Workspace")({
  id: M.Generated(WorkspaceId),
  ...M.baseFields,
}) {}

const ModalMethods = M.expose(Model);
export type WorkspaceModelType = typeof ModalMethods.Schema.Type;

export const WorkspaceModel = {
  ...ModalMethods,
};
