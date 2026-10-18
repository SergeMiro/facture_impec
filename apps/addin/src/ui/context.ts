import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Controller, FiState } from '../controller';

export const ControllerContext = createContext<Controller | null>(null);

export function useController(): Controller {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('ControllerContext is missing');
  return controller;
}

export function useFi(): [FiState, Controller] {
  const controller = useController();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return [state, controller];
}

/** Times in the UI are Europe/Paris (rule 4). */
const TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
});
const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const parisTime = (at: number | string) => TIME.format(new Date(at));
export const parisDateTime = (at: number | string) => DATE_TIME.format(new Date(at));
