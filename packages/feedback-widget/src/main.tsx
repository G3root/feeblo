import { MemoryRouter, Route } from "@solidjs/router";
import { BoardDetailComponent } from "./routes/board";
import { IndexComponent } from "./routes/index";
import { RootComponent } from "./routes/__root";

export function WidgetApp() {
  return (
    <MemoryRouter root={RootComponent}>
      <Route path="/" component={IndexComponent} />
      <Route path="/board/:boardId" component={BoardDetailComponent} />
    </MemoryRouter>
  );
}
