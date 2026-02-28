import type { ParentComponent } from "solid-js";
import { Navbar } from "../common/navbar";

export const PublicBoardShell: ParentComponent = (props) => {
  return (
    <div>
      <Navbar />
      {props.children}
    </div>
  );
};
