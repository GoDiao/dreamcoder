import { createContext } from "react";
import type {
  CatalogComponent,
  CatalogCustomComponent,
} from "../core/component-categories";
import type { CompiledComponent } from "./custom/types";
export interface ComponentLibrary {
  list: () => Promise<CatalogComponent[]>;
  read: (item: CatalogCustomComponent) => Promise<CompiledComponent>;
}
export const ComponentLibraryContext = createContext<ComponentLibrary | null>(
  null,
);
