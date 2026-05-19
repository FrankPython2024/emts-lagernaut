"use client";
import { createContext, useContext } from "react";

interface WidgetEditContextValue {
  editMode: boolean;
  widgetId: string;
  onHide:   (id: string) => void;
}

const WidgetEditContext = createContext<WidgetEditContextValue>({
  editMode: false,
  widgetId: "",
  onHide:   () => {},
});

export function useWidgetEditContext(): WidgetEditContextValue {
  return useContext(WidgetEditContext);
}

export const WidgetEditContextProvider = WidgetEditContext.Provider;
